#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║       Scrapling UI Monitor — Self-Healing Locator Generator      ║
║  Monitors a webpage for selector drift & writes locators.json    ║
║  for Playwright tests to consume.                                ║
╚══════════════════════════════════════════════════════════════════╝

FLOW:
  1.  Fetch target page HTML via Scrapling (HTTP or Dynamic/JS)
  2.  For each watched locator: try plain CSS selector first
  3.  If it fails → call adaptive=True (Scrapling similarity match)
  4.  Generate a healed selector from the recovered element
  5.  Write locators.json  ← Playwright tests read this file
  6.  Log all changes for audit trail

INSTALL:
  pip install "scrapling[fetchers]" requests
  scrapling install          # downloads browser binaries for DynamicFetcher

USAGE:
  python locator_monitor.py           # single scan (CI mode)
  python locator_monitor.py --watch   # continuous polling (60s interval)
  python locator_monitor.py --js      # use DynamicFetcher (SPAs / React / Vue)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ─── SCRAPLING ────────────────────────────────────────────────────────────────
from scrapling.fetchers import Fetcher

# ─── CONFIG ──────────────────────────────────────────────────────────────────
TARGET_URL     = "https://apply-qa.apps.asu.edu/"
LOCATORS_FILE  = Path("locators.json")
CHANGE_LOG     = Path("locator_changes.log")
POLL_INTERVAL  = 60   # seconds between scans in --watch mode

# ── Locators to monitor: logical_name → CSS selector ─────────────────────────
# Keep this in sync with the FALLBACKS dict in tests/helpers/healingLocator.js
WATCH_LIST: dict[str, str] = {
    "hero_heading":         "h1.h1-large",
    "view_app_details_btn": "button.bg-secondary",
    "mode_radio_group":     "#radio-mode-type",
    "in_person_card":       "button[value='in-person']",
    "online_card":          "button[value='online']",
    "degree_card":          "button[value='DG']",
    "nondegree_card":       "button[value='NDG']",
    "continue_button":      "[data-cy='user-create-account-create-account-button']",
    "sign_in_button":       "a.btn-primary[href='/user/login']",
    "app_details_section":  "#application-details",
    "contact_email":        "a[href='mailto:admissions@asu.edu']",
    "footer_services":      "[data-cy='default-footer-university-services-menu']",
}

# ─── LOGGING ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(CHANGE_LOG, mode="a", encoding="utf-8"),
    ],
)
log = logging.getLogger("locator_monitor")


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def load_previous_locators() -> dict:
    """Load the last saved locators.json (for change diffing)."""
    if LOCATORS_FILE.exists():
        try:
            return json.loads(LOCATORS_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("locators.json is malformed — starting fresh.")
    return {}


def save_locators(resolved: dict) -> None:
    """Persist resolved locators to locators.json for Playwright."""
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_url":   TARGET_URL,
        "locators":     resolved,
    }
    LOCATORS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log.info("✅  Saved %d locators → %s", len(resolved), LOCATORS_FILE)


def _safe_selector(el) -> str:
    """Return the best available CSS selector string for a Scrapling element."""
    gen = getattr(el, "generate_css_selector", None)
    return gen if isinstance(gen, str) and gen else ""


# ─── FETCH PAGE ──────────────────────────────────────────────────────────────

def fetch_page(url: str, use_dynamic: bool = False):
    """
    Fetch the target page and return a Scrapling Response (which is a Selector).

    - use_dynamic=False  → Scrapling Fetcher (fast HTTP, no JS)
    - use_dynamic=True   → DynamicFetcher (Playwright, full JS rendering)
                           Use for SPAs (React / Vue / Angular)

    For the dynamic path a page_action seeds one temporary todo so that
    conditional elements (ul.todo-list, li[data-testid='todo-item'], footer,
    filters, etc.) are present in the DOM before fingerprinting.
    The Response object is returned directly as a Selector — do NOT re-parse
    its raw body, which contains the pre-JS server HTML for React SPAs.
    """
    try:
        if use_dynamic:
            # Import lazily so users without browser binaries can still
            # run the HTTP-only path without errors.
            from scrapling.fetchers import DynamicFetcher

            def _seed_state(pw_page) -> None:
                """Select In-person + Degree-seeking so all conditional elements render."""
                pw_page.locator("button[value='in-person']").click()
                pw_page.locator("button[value='DG']").wait_for(state="visible")
                pw_page.locator("button[value='DG']").click()
                pw_page.locator("[data-cy='user-create-account-create-account-button']").wait_for(
                    state="visible"
                )

            log.info("🌐  Fetching with DynamicFetcher (JS rendering)…")
            return DynamicFetcher.fetch(
                url,
                selector_config={"adaptive": True},
                wait_selector="h1.h1-large",      # wait until page is hydrated
                page_action=_seed_state,          # seed state before capture
            )
        else:
            log.info("🌐  Fetching with Fetcher (HTTP)…")
            return Fetcher.get(url, selector_config={"adaptive": True})

    except Exception as exc:
        log.error("❌  Fetch failed: %s", exc)
        return None


# ─── CORE: CHECK + HEAL ───────────────────────────────────────────────────────

def check_and_heal(page) -> tuple[dict, list[str]]:
    """
    Iterate over WATCH_LIST using the Scrapling Response/Selector directly.
      1. Try plain CSS selector  (auto_save=True → saves fingerprint)
      2. If missing → try adaptive recovery
      3. Record status: 'ok' | 'healed' | 'missing'

    Returns
    -------
    resolved : dict   Locator entries keyed by name
    changed  : list   Names whose selector changed vs. original
    """
    resolved: dict = {}
    changed:  list = []

    for name, selector in WATCH_LIST.items():

        # ── Try plain selector first (and save fingerprint for future healing) ──
        el = page.css(selector, auto_save=True).first

        if el:
            # Selector works as-is ✅
            gen = _safe_selector(el)
            resolved[name] = {
                "original":  selector,
                "current":   selector,
                "generated": gen or selector,
                "status":    "ok",
            }
            log.debug("  ✔  [%s] ok: %s", name, selector)

        else:
            # Plain selector broke — attempt adaptive recovery 🔧
            adapted = page.css(selector, adaptive=True).first

            if adapted:
                gen = _safe_selector(adapted)
                healed_sel = gen or selector          # prefer generated; fall back to original
                resolved[name] = {
                    "original":  selector,
                    "current":   healed_sel,
                    "generated": gen or "",
                    "status":    "healed",
                }
                changed.append(name)
                log.warning(
                    "  🔧  [%s] HEALED: '%s'  →  '%s'",
                    name, selector, healed_sel,
                )

            else:
                # Truly missing — cannot heal ❌
                resolved[name] = {
                    "original":  selector,
                    "current":   selector,          # keep original so test fails loudly
                    "generated": "",
                    "status":    "missing",
                }
                changed.append(name)
                log.error("  ❌  [%s] MISSING — adaptive also failed: %s", name, selector)

    return resolved, changed


# ─── DIFF ────────────────────────────────────────────────────────────────────

def diff_vs_previous(new_resolved: dict, old_data: dict) -> list[str]:
    """Compare current 'current' selectors against the previous run."""
    old_locs = old_data.get("locators", {})
    diffs: list[str] = []
    for name, info in new_resolved.items():
        old_current = old_locs.get(name, {}).get("current")
        if old_current and old_current != info["current"]:
            diffs.append(name)
            log.warning(
                "  📝  [%s] selector changed: '%s'  →  '%s'",
                name, old_current, info["current"],
            )
    return diffs


# ─── MAIN LOOP ────────────────────────────────────────────────────────────────

def run(once: bool = True, use_dynamic: bool = False) -> None:
    log.info("🕷   Scrapling UI Monitor  |  target: %s", TARGET_URL)
    log.info("     Watching %d locators  |  mode: %s",
             len(WATCH_LIST), "single-scan" if once else "watch")

    while True:
        log.info("─" * 60)
        log.info("🔍  Scanning for locator health…")

        page = fetch_page(TARGET_URL, use_dynamic=use_dynamic)

        if page is None:
            log.error("⚠   Page unreachable — skipping this cycle.")
        else:
            old_data              = load_previous_locators()
            resolved, healed_list = check_and_heal(page)
            diff_list             = diff_vs_previous(resolved, old_data)

            save_locators(resolved)

            n_ok      = sum(1 for v in resolved.values() if v["status"] == "ok")
            n_healed  = sum(1 for v in resolved.values() if v["status"] == "healed")
            n_missing = sum(1 for v in resolved.values() if v["status"] == "missing")

            log.info(
                "\n📊  Summary — ✅ OK: %d  🔧 Healed: %d  ❌ Missing: %d",
                n_ok, n_healed, n_missing,
            )

            if diff_list:
                log.warning("⚡  UI changes detected in: %s", ", ".join(diff_list))
            else:
                log.info("✅  No locator changes vs. previous run.")

        if once:
            break

        log.info("💤  Next scan in %ds  (Ctrl+C to stop)…", POLL_INTERVAL)
        time.sleep(POLL_INTERVAL)


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrapling UI Monitor — generates locators.json for Playwright tests"
    )
    parser.add_argument(
        "--watch", action="store_true",
        help=f"Poll continuously every {POLL_INTERVAL}s (default: single scan)",
    )
    parser.add_argument(
        "--js", action="store_true",
        help="Use DynamicFetcher (Playwright) for JS-rendered SPAs",
    )
    args = parser.parse_args()
    run(once=not args.watch, use_dynamic=args.js)
