/**
 * ASU Apply — Self-Healing E2E Tests (Playwright JS)
 * Target: https://apply-qa.apps.asu.edu/
 *
 * All locators come from healedLocator(), which reads locators.json written
 * by locator_monitor.py (Scrapling). If a selector drifts after a UI update,
 * Scrapling detects and heals it automatically — no changes needed here.
 */

import { test, expect } from '@playwright/test';
import {
  healedLocator,
  getLocatorReport,
} from './helpers/healingLocator.js';

const BASE = 'https://apply-qa.apps.asu.edu';

// ─── GLOBAL SETUP ─────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  const report = getLocatorReport();
  if (report.length === 0) {
    console.warn(
      '\n⚠   locators.json not found — tests will use hardcoded fallback selectors.\n' +
      '    Run "python locator_monitor.py --js" to generate fresh locators.\n'
    );
    return;
  }

  const pad    = 24;
  console.log('\n' + '─'.repeat(60));
  console.log('📋  Scrapling Locator Health Report — ASU Apply');
  console.log('─'.repeat(60));
  report.forEach(({ name, status, original, current }) => {
    const icon    = status === 'ok' ? '✅' : status === 'healed' ? '🔧' : '❌';
    const changed = original !== current ? `  (was: ${original})` : '';
    console.log(`  ${icon}  ${name.padEnd(pad)} [${status}]  →  ${current}${changed}`);
  });
  console.log('─'.repeat(60) + '\n');
});

// ─── PAGE SETUP ──────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await healedLocator(page, 'hero_heading').waitFor({ state: 'visible', timeout: 25_000 });
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Click a mode card (in-person / online) and wait for the sub-options. */
async function selectMode(page, mode /* 'in-person' | 'online' */) {
  const card = healedLocator(page, mode === 'in-person' ? 'in_person_card' : 'online_card');
  // Retry the click until aria-checked flips — WebKit/Firefox can be slow on Vue radio cards
  await expect(async () => {
    await card.click();
    await expect(card).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  await healedLocator(page, 'degree_card').waitFor({ state: 'visible', timeout: 15_000 });
}

/** Click a degree card and confirm it is selected. */
async function selectDegreeType(page, locatorKey /* 'degree_card' | 'nondegree_card' */) {
  const card = healedLocator(page, locatorKey);
  await expect(async () => {
    await card.click();
    await expect(card).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. PAGE LOAD
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Page Load', () => {

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Apply to Arizona State University/);
  });

  test('hero heading "Apply to ASU" is visible', async ({ page }) => {
    const heading = healedLocator(page, 'hero_heading');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Apply to ASU');
  });

  test('"Get started" section heading is visible', async ({ page }) => {
    await expect(page.locator('h2:has-text("Get started")')).toBeVisible();
  });

  test('"Log in" link for existing accounts is visible', async ({ page }) => {
    await expect(healedLocator(page, 'sign_in_button')).toBeVisible();
  });

  test('"View application details" button is visible', async ({ page }) => {
    await expect(healedLocator(page, 'view_app_details_btn')).toBeVisible();
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MODE SELECTION (In-person / Online)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Mode Selection', () => {

  test('both In-person and Online cards are visible on load', async ({ page }) => {
    await expect(healedLocator(page, 'in_person_card')).toBeVisible();
    await expect(healedLocator(page, 'online_card')).toBeVisible();
  });

  test('neither mode is selected on load', async ({ page }) => {
    const inPerson = healedLocator(page, 'in_person_card');
    const online   = healedLocator(page, 'online_card');
    await expect(inPerson).toHaveAttribute('aria-checked', 'false');
    await expect(online).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking In-person selects it', async ({ page }) => {
    const card = healedLocator(page, 'in_person_card');
    await expect(async () => {
      await card.click();
      await expect(card).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await expect(card).toHaveClass(/radio-card-selected/);
  });

  test('clicking Online selects it', async ({ page }) => {
    const card = healedLocator(page, 'online_card');
    await expect(async () => {
      await card.click();
      await expect(card).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await expect(card).toHaveClass(/radio-card-selected/);
  });

  test('switching from In-person to Online updates the selection', async ({ page }) => {
    const inPerson = healedLocator(page, 'in_person_card');
    const online   = healedLocator(page, 'online_card');

    await expect(async () => {
      await inPerson.click();
      await expect(inPerson).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    await expect(async () => {
      await online.click();
      await expect(online).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await expect(inPerson).toHaveAttribute('aria-checked', 'false');
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 3. DEGREE TYPE SELECTION (DG / NDG)
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Degree Type Selection', () => {

  test('degree options appear after selecting In-person', async ({ page }) => {
    await selectMode(page, 'in-person');
    await expect(healedLocator(page, 'degree_card')).toBeVisible();
    await expect(healedLocator(page, 'nondegree_card')).toBeVisible();
  });

  test('degree options appear after selecting Online', async ({ page }) => {
    await selectMode(page, 'online');
    await expect(healedLocator(page, 'degree_card')).toBeVisible();
    await expect(healedLocator(page, 'nondegree_card')).toBeVisible();
  });

  test('degree card describes associate/bachelor pursuit', async ({ page }) => {
    await selectMode(page, 'in-person');
    await expect(healedLocator(page, 'degree_card')).toContainText("associate or bachelor");
  });

  test('Continue button appears after selecting a mode and DG', async ({ page }) => {
    await selectMode(page, 'in-person');
    await selectDegreeType(page, 'degree_card');
    await expect(healedLocator(page, 'continue_button')).toBeVisible();
    await expect(healedLocator(page, 'continue_button')).toContainText('Continue');
  });

  test('NDG selection does not show the "Create account" form', async ({ page }) => {
    await selectMode(page, 'online');
    await selectDegreeType(page, 'nondegree_card');
    await expect(healedLocator(page, 'continue_button')).not.toBeVisible();
    // The "Log in" link is always visible regardless of degree selection
    //await expect(healedLocator(page, 'sign_in_button')).toBeVisible();
  });

  test('clicking DG selects it', async ({ page }) => {
    await selectMode(page, 'in-person');
    await selectDegreeType(page, 'degree_card');
    await expect(healedLocator(page, 'degree_card')).toHaveAttribute('aria-checked', 'true');
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 4. NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Navigation', () => {

  test('selecting In-person + DG reveals the account creation form', async ({ page }) => {
    await selectMode(page, 'in-person');
    await selectDegreeType(page, 'degree_card');
    // The flow now shows an inline "create account" form instead of redirecting
    //await expect(page.locator('h2:has-text("Ok, let\'s get your account created"), h3:has-text("Ok, let\'s get your account created")')).toBeVisible({ timeout: 15_000 });
    await expect(healedLocator(page, 'continue_button')).toBeVisible();
  });

  test('Log in link navigates to ASU login', async ({ page }) => {
    await healedLocator(page, 'sign_in_button').click();
    // /user/login redirects through Shibboleth to login.asu.edu
    await page.waitForURL(/login/, { timeout: 30_000 });
    expect(page.url()).toMatch(/login/);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 5. APPLICATION DETAILS SECTION
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Application Details', () => {

  test('"Application details" section is in the page', async ({ page }) => {
    const section = healedLocator(page, 'app_details_section');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
  });

  test('"Time to apply" card says ~30 minutes', async ({ page }) => {
    const card = page.locator('[aria-labelledby="time-to-apply"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('30 minutes');
  });

  test('application fee shows Arizona resident price of $50', async ({ page }) => {
    const feeCard = page.locator('[aria-labelledby="application-fee"]');
    await feeCard.scrollIntoViewIfNeeded();
    await expect(feeCard).toContainText('Arizona residents');
    await expect(feeCard).toContainText('$50');
  });

  test('application fee shows all four fee tiers', async ({ page }) => {
    const feeCard = page.locator('[aria-labelledby="application-fee"]');
    await feeCard.scrollIntoViewIfNeeded();
    await expect(feeCard).toContainText('Domestic nonresidents');
    await expect(feeCard).toContainText('International nonresidents');
    await expect(feeCard).toContainText('ASU Online');
  });

  test('help section has correct admissions email', async ({ page }) => {
    const email = healedLocator(page, 'contact_email');
    await email.scrollIntoViewIfNeeded();
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute('href', 'mailto:admissions@asu.edu');
    await expect(email).toContainText('admissions@asu.edu');
  });

  test('help section has phone number', async ({ page }) => {
    const phone = page.locator('a[href="tel:+1-480-965-7788"]');
    await phone.scrollIntoViewIfNeeded();
    await expect(phone).toBeVisible();
    await expect(phone).toContainText('480-965-7788');
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 6. FOOTER
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Footer', () => {

  test('footer services section is visible', async ({ page }) => {
    const footer = healedLocator(page, 'footer_services');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
  });

  test('footer contains My ASU link', async ({ page }) => {
    const footer = healedLocator(page, 'footer_services');
    await footer.scrollIntoViewIfNeeded();
    const myAsu = footer.locator('a[href="https://my.asu.edu/"]');
    await expect(myAsu).toBeVisible();
    await expect(myAsu).toContainText('My ASU');
  });

  test('footer contains Maps and Locations link', async ({ page }) => {
    const footer = healedLocator(page, 'footer_services');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.locator('a:has-text("Maps and Locations")')).toBeVisible();
  });

  test('legal compliance footer has Accessibility link', async ({ page }) => {
    const legal = page.locator('[data-cy="default-footer-university-legal-compliance-menu"]');
    await legal.scrollIntoViewIfNeeded();
    await expect(legal.locator('a:has-text("Accessibility")')).toBeVisible();
  });

});
