# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Self-healing E2E test automation. Python (`locator_monitor.py`) uses [Scrapling](https://github.com/D4Vinci/Scrapling) to fingerprint CSS selectors and detect UI drift. When a selector breaks, Scrapling's adaptive similarity matching finds the closest-matching element and writes a healed selector to `locators.json`. Playwright tests (JS) consume `locators.json` via `healedLocator()` so they never need code changes when the UI changes.

Target app: `https://demo.playwright.dev/todomvc` (React SPA).

## Setup

```bash
# Python
pip install "scrapling[fetchers]"
scrapling install   # downloads browser binaries for DynamicFetcher / --js mode

# Node
npm install
npx playwright install --with-deps chromium
```

## Commands

```bash
# Generate / refresh locators.json (run before Playwright tests)
python locator_monitor.py            # HTTP fetcher (fast, SSR pages)
python locator_monitor.py --js       # DynamicFetcher (React/Vue/Angular SPAs — use this for the demo target)
python locator_monitor.py --watch    # continuous mode, re-scans every 60s

# Run Playwright tests
npx playwright test                  # headless, all browsers
npx playwright test --project=chromium  # single browser
npx playwright test --headed         # visible browser
npx playwright test --debug          # step-through debugger
npx playwright test --ui             # interactive UI mode
npx playwright show-report           # open HTML report after a run

# CI pipelines (heal + test in one command)
npm run ci      # HTTP fetcher
npm run ci:js   # DynamicFetcher (use this for the TodoMVC demo)
```

## Architecture

### Data flow

```
locator_monitor.py  →  locators.json  →  healingLocator.js  →  todo.spec.js
```

1. **`locator_monitor.py`** fetches the page HTML, iterates `WATCH_LIST`, tries each CSS selector with `auto_save=True` (saves an element fingerprint). If the selector returns nothing, it retries with `adaptive=True` (Scrapling similarity recovery), then writes `locators.json` with per-locator `status: "ok" | "healed" | "missing"`.

2. **`tests/helpers/healingLocator.js`** reads `locators.json` (60 s in-memory cache) and exposes:
   - `getSelector(name)` — returns the best CSS string
   - `healedLocator(page, name)` — returns a Playwright `Locator`
   - `getLocatorReport()` — health summary for `beforeAll` logging
   - `invalidateLocatorCache()` — force-refresh during a long run

3. **`tests/todo.spec.js`** never hardcodes CSS selectors — every element access goes through `healedLocator(page, name)`.

### Adding a new locator

Both locations must stay in sync:
- `WATCH_LIST` in `locator_monitor.py` — `"logical_name": "css-selector"`
- `FALLBACKS` in `tests/helpers/healingLocator.js` — same key/selector pair

Fallbacks are used when `locators.json` hasn't been generated yet.

### Fetcher choice

| Page type | Flag | Scrapling fetcher |
|-----------|------|-------------------|
| Server-rendered | *(default)* | `Fetcher` (HTTP) |
| SPA (React/Vue/Angular) | `--js` | `DynamicFetcher` (Playwright) |

The demo target is a React SPA — always use `--js` or `npm run ci:js`.

### Key files

| File | Role |
|------|------|
| `locator_monitor.py` | Python monitor — fetch, fingerprint, heal, write |
| `locators.json` | Auto-generated output — **do not hand-edit** |
| `locator_changes.log` | Audit trail of all selector changes |
| `tests/helpers/healingLocator.js` | JS bridge between `locators.json` and Playwright |
| `tests/todo.spec.js` | Playwright E2E tests |
| `playwright.config.js` | Timeout, retry, browser, and reporter config |
