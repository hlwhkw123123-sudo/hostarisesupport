// cPanel browser helper (Milestone 6) — Hostarise AI Agent.
//
// Resilient cPanel login: cPanel login pages differ between hosts and
// versions, so NO single selector is ever assumed. findField() tries, in
// order, placeholder text, aria-label, name attribute, and <label> text
// (via the label's `for` attribute or an input nested inside the label).
//
// loginFlow() drives a login through the browser engine: it navigates to
// the login URL, fills the username/password fields found resiliently,
// submits, and verifies login by looking for a logout link or a
// dashboard marker. It returns { ok, evidence }.
//
// NEVER bypass CAPTCHA/MFA: if a captcha marker appears, the engine
// throws 'captcha detected — human assistance required' and the flow
// stops. Passwords are NEVER logged (values are passed straight to
// engine.fill, which never logs them).
import { CAPTCHA_ERROR, detectCaptcha } from './engine.js';

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'input[value*="Log in" i]',
];

const LOGOUT_SELECTORS = [
  'a:has-text("Log out")',
  'a:has-text("Logout")',
  'a:has-text("Log Out")',
  'button:has-text("Log out")',
  'a[href*="logout" i]',
];

// Dashboard markers that indicate a successful cPanel login.
const DASHBOARD_MARKERS = [
  /cPanel/i,
  /dashboard/i,
  /file manager/i,
  /welcome/i,
];

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Try a Playwright locator; return { locator, selector } if it matches a
// visible element, otherwise null. `selector` is the exact string the
// caller can reuse with engine.fill()/engine.click().
async function trySelector(page, selector) {
  const locator = page.locator(selector).first();
  try {
    if ((await locator.count()) === 0) return null;
    await locator.waitFor({ state: 'visible', timeout: 2000 });
    return { locator, selector };
  } catch {
    return null;
  }
}

// findField(page, labels[]) — tries each label in order, and for each
// label tries placeholder, aria-label, name attribute, then <label> text.
// Returns { locator, selector } for the first visible match, or null.
// `page` is a Playwright page (engine.getPage(sessionId)).
export async function findField(page, labels) {
  for (const label of labels) {
    const safe = escapeAttr(label);
    const candidates = [
      `input[placeholder*="${safe}" i]`,
      `textarea[placeholder*="${safe}" i]`,
      `input[aria-label*="${safe}" i]`,
      `input[name*="${safe}" i]`,
      `input[id*="${safe}" i]`,
    ];
    for (const selector of candidates) {
      const found = await trySelector(page, selector);
      if (found) return found;
    }
    // <label> text: either <label for="id"> + #id, or an input nested
    // inside the <label> element.
    try {
      const labelLocator = page.locator(`label:text("${safe}")`).first();
      if ((await labelLocator.count()) > 0) {
        const forAttr = await labelLocator.getAttribute('for').catch(() => null);
        if (forAttr) {
          const byId = await trySelector(page, `#${forAttr}`);
          if (byId) return byId;
        }
        const nested = await trySelector(page, `label:text("${safe}") >> input`);
        if (nested) return nested;
      }
    } catch {
      // Fall through to the next label.
    }
  }
  return null;
}

async function findSubmit(page) {
  for (const selector of SUBMIT_SELECTORS) {
    const found = await trySelector(page, selector);
    if (found) return found;
  }
  return null;
}

async function findLogoutLink(page) {
  for (const selector of LOGOUT_SELECTORS) {
    const found = await trySelector(page, selector);
    if (found) return found;
  }
  return null;
}

// loginFlow(sessionId, { url, username, password, engine, ... })
// `engine` is the browser engine from createBrowserEngine() (passed in
// opts because this helper is engine-agnostic). `allowPrivate` is passed
// through to the engine's URL guard (local test servers only).
// Returns { ok, evidence } — evidence names what verified (or failed)
// the login, never the password.
export async function loginFlow(sessionId, { url, username, password, engine, allowPrivate = false, navigationTimeoutMs } = {}) {
  if (!engine) throw new Error('loginFlow requires the browser engine (pass { engine })');
  if (!url) throw new Error('loginFlow requires a login url');
  if (username === undefined || password === undefined) {
    throw new Error('loginFlow requires a username and password');
  }

  await engine.navigate(sessionId, url, { allowPrivate, navigationTimeoutMs });
  const page = engine.getPage(sessionId);

  const userField = await findField(page, ['Username', 'User Name', 'User', 'Email']);
  if (!userField) return { ok: false, evidence: 'username field not found on login page' };
  const passField = await findField(page, ['Password', 'Pass']);
  if (!passField) return { ok: false, evidence: 'password field not found on login page' };

  await engine.fill(sessionId, userField.selector, username);
  await engine.fill(sessionId, passField.selector, password);

  const submit = await findSubmit(page);
  if (!submit) return { ok: false, evidence: 'submit button not found on login page' };
  await engine.click(sessionId, submit.selector);

  // Wait briefly for the post-login page to settle.
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    // Slow pages may never reach networkidle; verification below decides.
  }

  const html = await engine.content(sessionId).catch((err) => {
    if (err.message === CAPTCHA_ERROR) throw err;
    return '';
  });
  if (detectCaptcha(html)) throw new Error(CAPTCHA_ERROR);

  const logout = await findLogoutLink(page);
  if (logout) return { ok: true, evidence: 'logout link present after login' };
  const marker = DASHBOARD_MARKERS.find((re) => re.test(html));
  if (marker) return { ok: true, evidence: `dashboard marker present after login (${marker})` };

  const failed = /login (attempt )?failed|invalid (username|password|login)|incorrect password|authentication failed/i.test(html);
  if (failed) return { ok: false, evidence: 'login failed: error message shown on page' };
  return { ok: false, evidence: 'login not verified: no logout link or dashboard marker found' };
}

// Convenience factory: binds loginFlow to one engine instance.
export function createCpanelHelper(engine) {
  return {
    findField,
    loginFlow: (sessionId, opts) => loginFlow(sessionId, { ...opts, engine }),
  };
}
