// Browser Automation Engine (Milestone 6) — Hostarise AI Agent.
//
// Playwright-based browser automation: open/navigate/click/fill, page text,
// screenshots, and session cleanup. One isolated browser context per
// session; every session is tracked and closed explicitly.
//
// HONEST LIMIT — Termux / Android:
// Playwright on Termux/Android is EXPERIMENTAL and UNVERIFIED here.
// Playwright's official Android support automates Chrome for Android /
// WebView via ADB (needs Chrome 105+, device awake for screenshots, "not
// everything works"), and there is NO official `chromium.launch()` inside
// Termux. A third-party package (termux-playwright) claims native Chromium
// via CDP without root but is unverified third-party material. Do NOT claim
// Termux browser support until physically tested on the owner's phone.
// This engine is built as a separate abstraction so it can run on a
// separate Linux service / VPS if Android Chromium fails (SPEC §6).
// Telegram + Gemini + diagnostics (no browser) work without it.
//
// Safety rules enforced here (SPEC §3C, §4):
// - EVERY URL the browser opens passes checkUrlSafe() first (SSRF guard).
//   Private/loopback/metadata URLs are refused unless the caller
//   explicitly passes { allowPrivate: true } (local test server only).
// - Playwright is LAZY-imported (dynamic import inside open()) so the
//   rest of the app runs with no browser installed.
// - NEVER bypass CAPTCHA/MFA: if page content contains a captcha
//   challenge marker, the operation throws
//   'captcha detected — human assistance required' and stops.
// - Values passed to fill() are NEVER logged.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { checkUrlSafe } from '../security.js';

export const CAPTCHA_ERROR = 'captcha detected — human assistance required';
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;
export const DEFAULT_ACTION_TIMEOUT_MS = 10000;

// Markers that indicate a captcha / human-verification challenge page.
// Checked against page HTML/text. Kept deliberately narrow so ordinary
// pages that merely mention the word in prose are not all blocked: the
// strongest markers (recaptcha/hcaptcha/turnstile widget scripts and
// "verify you are human" prompts) are what trigger this.
const CAPTCHA_MARKERS = [
  /recaptcha/i,
  /hcaptcha/i,
  /cf-turnstile/i,
  /turnstile/i,
  /verify you are human/i,
  /i'?m not a robot/i,
  /are you a robot/i,
  /please verify you'?re (not )?a robot/i,
  /complete the captcha/i,
  /captcha challenge/i,
];

// Pure, browser-free captcha check over page HTML/text. Exported so it
// can be unit-tested without Chromium.
export function detectCaptcha(content) {
  if (typeof content !== 'string' || content.length === 0) return false;
  return CAPTCHA_MARKERS.some((re) => re.test(content));
}

function assertCaptchaFree(content) {
  if (detectCaptcha(content)) throw new Error(CAPTCHA_ERROR);
}

// Best-effort synchronous check for a usable Chromium binary, used by
// isAvailable(). Looks at PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH first,
// then the standard Playwright browser cache (~/.cache/ms-playwright).
function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)
      ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      : null;
  }
  const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(process.env.HOME || '~', '.cache', 'ms-playwright');
  try {
    if (!fs.existsSync(cacheDir)) return null;
    for (const entry of fs.readdirSync(cacheDir)) {
      if (!entry.startsWith('chromium-')) continue;
      // Layout varies by Playwright/Chrome-for-Testing version:
      // chrome-linux/chrome (older) or chrome-linux64/chrome (newer),
      // plus the headless-shell build's headless_shell binary.
      const candidates = [
        path.join(cacheDir, entry, 'chrome-linux', 'chrome'),
        path.join(cacheDir, entry, 'chrome-linux64', 'chrome'),
        path.join(cacheDir, entry, 'chrome-linux', 'headless_shell'),
        path.join(cacheDir, entry, 'chrome-linux64', 'headless_shell'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function createBrowserEngine({ config, logger } = {}) {
  const log = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const browserEnabled = config?.browserEnabled !== false;
  const sessions = new Map(); // sessionId -> { browser, context, page, url }
  let browserPromise = null; // shared launched browser (contexts isolate sessions)
  let playwrightModule = null;

  function playwrightAvailable() {
    try {
      createRequire(import.meta.url).resolve('playwright');
      return true;
    } catch {
      return false;
    }
  }

  // Synchronous availability probe: false when the browser is disabled
  // in config, when Playwright is not installed, or when no Chromium
  // binary can be found. A true result still does not guarantee a
  // launch succeeds (e.g. missing system libraries); open() reports
  // launch failures with their real cause.
  function isAvailable() {
    if (!browserEnabled) return false;
    if (!playwrightAvailable()) return false;
    return findChromiumExecutable() !== null;
  }

  async function ensureBrowser() {
    if (!browserEnabled) {
      throw new Error('Browser is disabled: set BROWSER_ENABLED=true to enable browser automation');
    }
    if (!playwrightModule) {
      try {
        // LAZY import: the rest of the app must run without Playwright.
        playwrightModule = await import('playwright');
      } catch (err) {
        throw new Error(`Playwright is not available: ${err.message}. Install it with 'npm install playwright' and fetch a browser with 'npx playwright install chromium'.`);
      }
    }
    if (!browserPromise) {
      browserPromise = playwrightModule.chromium.launch({ headless: true }).catch((err) => {
        browserPromise = null;
        throw new Error(`Chromium launch failed: ${err.message}. Run 'npx playwright install chromium' and check missing system libraries with 'npx playwright install-deps chromium'.`);
      });
    }
    return browserPromise;
  }

  function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`unknown browser session: ${sessionId}`);
    return session;
  }

  async function guardUrl(rawUrl, { allowPrivate = false } = {}) {
    const check = await checkUrlSafe(rawUrl, { allowPrivate });
    if (!check.ok) {
      throw new Error(`URL refused by safety check (${check.reason}): ${rawUrl}`);
    }
    return check.url;
  }

  // Open a URL in a fresh isolated browser context. Returns a session id.
  // opts: { allowPrivate, navigationTimeoutMs, screenshotPath, viewport }
  async function open(rawUrl, opts = {}) {
    // Disabled check first so the error names the real cause; the URL
    // guard still runs before any browser launch below.
    if (!browserEnabled) {
      throw new Error('Browser is disabled: set BROWSER_ENABLED=true to enable browser automation');
    }
    const url = await guardUrl(rawUrl, opts);
    const browser = await ensureBrowser();
    const navigationTimeoutMs = opts.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS);
    const sessionId = randomUUID();
    sessions.set(sessionId, { browser, context, page, url: url.href });
    log.info('browser session opened', { sessionId, url: url.href });
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
      assertCaptchaFree(await page.content());
    } catch (err) {
      await close(sessionId).catch(() => {});
      throw err;
    }
    if (opts.screenshotPath) {
      await page.screenshot({ path: opts.screenshotPath, type: 'png' });
    }
    return sessionId;
  }

  async function navigate(sessionId, rawUrl, opts = {}) {
    const session = getSession(sessionId);
    const url = await guardUrl(rawUrl, opts);
    const navigationTimeoutMs = opts.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    await session.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
    session.url = url.href;
    assertCaptchaFree(await session.page.content());
    log.info('browser session navigated', { sessionId, url: url.href });
    return sessionId;
  }

  async function click(sessionId, selector, opts = {}) {
    const session = getSession(sessionId);
    assertCaptchaFree(await session.page.content());
    const timeout = opts.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
    const locator = session.page.locator(selector);
    try {
      await locator.waitFor({ state: 'visible', timeout });
    } catch {
      throw new Error(`selector not found within ${timeout}ms: ${selector}`);
    }
    await locator.click({ timeout });
    log.info('browser click', { sessionId, selector });
  }

  async function fill(sessionId, selector, value, opts = {}) {
    const session = getSession(sessionId);
    assertCaptchaFree(await session.page.content());
    const timeout = opts.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
    const locator = session.page.locator(selector);
    try {
      await locator.waitFor({ state: 'visible', timeout });
    } catch {
      throw new Error(`selector not found within ${timeout}ms: ${selector}`);
    }
    // NEVER log `value`: it may be a password or other secret.
    await locator.fill(value, { timeout });
    log.info('browser fill', { sessionId, selector });
  }

  async function getText(sessionId, selector, opts = {}) {
    const session = getSession(sessionId);
    assertCaptchaFree(await session.page.content());
    const timeout = opts.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
    const locator = session.page.locator(selector);
    try {
      await locator.waitFor({ state: 'visible', timeout });
    } catch {
      throw new Error(`selector not found within ${timeout}ms: ${selector}`);
    }
    const text = await locator.textContent({ timeout });
    return text ?? '';
  }

  async function screenshot(sessionId, opts = {}) {
    const session = getSession(sessionId);
    const buffer = await session.page.screenshot({ type: 'png', ...(opts.path ? { path: opts.path } : {}) });
    log.info('browser screenshot', { sessionId, bytes: buffer.length });
    return buffer;
  }

  async function content(sessionId) {
    const session = getSession(sessionId);
    const html = await session.page.content();
    assertCaptchaFree(html);
    return html;
  }

  // Exposed for helpers that need the raw Playwright page (e.g. the
  // cPanel helper's resilient field search). Prefer the session methods
  // above; do not bypass the captcha/URL guards through this accessor.
  function getPage(sessionId) {
    return getSession(sessionId).page;
  }

  function sessionCount() {
    return sessions.size;
  }

  async function close(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`unknown browser session: ${sessionId}`);
    sessions.delete(sessionId);
    try { await session.context.close(); } catch (err) {
      log.warn('browser context close error', { sessionId, error: err.message });
    }
    log.info('browser session closed', { sessionId });
  }

  async function closeAll() {
    const ids = [...sessions.keys()];
    for (const id of ids) {
      await close(id).catch(() => {});
    }
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      browserPromise = null;
      if (browser) {
        try { await browser.close(); } catch (err) {
          log.warn('browser close error', { error: err.message });
        }
      }
    }
    log.info('browser engine closed all sessions', { closedSessions: ids.length });
  }

  return {
    isAvailable,
    open,
    navigate,
    click,
    fill,
    getText,
    screenshot,
    content,
    getPage,
    sessionCount,
    close,
    closeAll,
  };
}
