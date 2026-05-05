<<<<<<< HEAD
# Scraplingdemo
=======
# Self-Healing Test Automation
### Scrapling (Python) + Playwright (JS)

A practical pattern for resilient E2E automation:

- **Python side** (`locator_monitor.py`) uses [Scrapling](https://github.com/D4Vinci/Scrapling) to scan the target page, fingerprint each selector, and detect when the UI changes. If a selector breaks, Scrapling's adaptive similarity matching automatically finds the closest-matching element and generates a healed selector.
- **JS side** (`tests/`) uses Playwright for real browser automation. The `healedLocator()` helper reads `locators.json` (written by Python) so every test automatically gets the latest working selector — no code changes needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Python  ·  locator_monitor.py  (Scrapling)                     │
│                                                                  │
│  1. Fetch page HTML (HTTP or JS-rendered via DynamicFetcher)     │
│  2. For each watched locator:                                    │
│       a. Try plain CSS selector  → auto_save=True (fingerprint) │
│       b. If broken → adaptive=True  (similarity recovery)       │
│       c. Record status: ok | healed | missing                   │
│  3. Write locators.json  ──────────────────────────────────┐    │
└────────────────────────────────────────────────────────────│────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  JS  ·  tests/helpers/healingLocator.js                         │
│                                                                  │
│  loadLocators()      reads locators.json (60 s cache)           │
│  getSelector(name)   returns best CSS string                     │
│  healedLocator(page, name)   returns Playwright Locator         │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  JS  ·  tests/todo.spec.js  (Playwright tests)                  │
│                                                                  │
│  Never hardcode CSS — always call healedLocator(page, name)     │
│  Tests run unchanged even after UI refactors                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install Python dependencies

```bash
pip install "scrapling[fetchers]"
scrapling install          # downloads browser binaries (for --js mode)
```

### 2. Install Node dependencies

```bash
npm install
npx playwright install --with-deps chromium
```

### 3. Scan the page & generate locators.json

```bash
# For server-rendered pages (fast HTTP):
python locator_monitor.py

# For SPAs / React / Vue / Angular (uses Playwright to render JS first):
python locator_monitor.py --js

# Continuous watch mode (re-scans every 60 s):
python locator_monitor.py --watch
```

### 4. Run Playwright tests

```bash
npx playwright test                   # headless, all browsers
npx playwright test --headed          # visible browser
npx playwright test --project=chromium   # single browser
npx playwright test --ui              # interactive UI mode
```

### 5. Full CI pipeline (one command)

```bash
npm run ci        # heal + test (HTTP fetcher)
npm run ci:js     # heal + test (JS/Dynamic fetcher for SPAs)
```

---

## How Self-Healing Works

### Scrapling adaptive mode (Python)

```python
# Run 1 — save fingerprint
page = Selector(html, adaptive=True, url=TARGET_URL)
el   = page.css_first("input.new-todo", auto_save=True)   # ✅ works, saves fingerprint

# Later — class renamed to "todo-input" by a developer
el   = page.css_first("input.new-todo")                   # ❌ returns None
el   = page.css_first("input.new-todo", adaptive=True)    # ✅ similarity match recovers it
#  → generates new selector: "input.todo-input"
#  → writes to locators.json: { status: "healed", current: "input.todo-input" }
```

### Playwright consuming the healed selector (JS)

```js
// Before healing: page.locator("input.new-todo")
// After healing:  page.locator("input.todo-input")   ← transparently swapped
const input = healedLocator(page, 'new_todo_input');
await input.fill('Buy milk');
```

---

## Project Structure

```
self-healing-tests/
├── locator_monitor.py          ← Scrapling UI monitor (Python)
├── locators.json               ← Auto-generated; DO NOT hand-edit
├── locator_changes.log         ← Audit trail of all selector changes
├── requirements.txt
├── package.json
├── playwright.config.js
└── tests/
    ├── helpers/
    │   └── healingLocator.js   ← Self-healing locator bridge (JS)
    └── todo.spec.js            ← Playwright E2E tests
```

---

## Fetcher Choice

| Page type              | Command flag | Scrapling fetcher    |
|------------------------|-------------|----------------------|
| Server-rendered (SSR)  | *(default)* | `Fetcher` (HTTP)     |
| SPA (React/Vue/Angular)| `--js`      | `DynamicFetcher` (Playwright) |

Use `--js` whenever the app requires JavaScript to render its DOM. The TodoMVC demo at `demo.playwright.dev/todomvc` is a React SPA, so use `--js` for it.

---

## Locators Reference

| Key               | Default selector          |
|-------------------|---------------------------|
| `new_todo_input`  | `input.new-todo`          |
| `todo_list`       | `ul.todo-list`            |
| `todo_item`       | `li.todo`                 |
| `toggle_all`      | `input.toggle-all`        |
| `app_footer`      | `footer.footer`           |
| `filter_all`      | `a[href='#/']`            |
| `filter_active`   | `a[href='#/active']`      |
| `filter_completed`| `a[href='#/completed']`   |
| `clear_completed` | `button.clear-completed`  |
| `todo_count`      | `span.todo-count`         |

To add new locators: add to `WATCH_LIST` in `locator_monitor.py` **and** to `FALLBACKS` in `tests/helpers/healingLocator.js`.
>>>>>>> f156da8 (Initial commit)
