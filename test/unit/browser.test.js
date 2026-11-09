// Browser Automation Engine tests (Milestone 6).
//
// Browser-dependent tests run against a LOCAL node:http test website
// only (no external sites). If no Chromium binary is available in this
// environment, those tests SKIP with a clear reason — they are never
// faked as passing. The non-browser tests (URL guard, captcha detection,
// session bookkeeping with a disabled engine) always run.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBrowserEngine, detectCaptcha, CAPTCHA_ERROR } from '../../src/browser/engine.js';
import { findField, loginFlow } from '../../src/browser/cpanel.js';
import { createLogger } from '../../src/logger.js';
import { checkUrlSafe } from '../../src/security.js';

const logger = createLogger({ level: 'error' });
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const FORM_PAGE = `<!doctype html><html><head><title>Test Page</title></head><body>
<h1 id="heading">Hello Browser</h1>
<p id="status">ready</p>
<form id="greet-form" onsubmit="return false;">
  <label for="name-input">Your name</label>
  <input id="name-input" name="username" placeholder="Your name" type="text">
  <input id="pass-input" name="password" placeholder="Password" type="password">
  <button id="greet-btn" type="button">Greet me</button>
</form>
<p id="result"></p>
<script>
  document.getElementById('greet-btn').addEventListener('click', () => {
    const name = document.getElementById('name-input').value || 'stranger';
    document.getElementById('result').textContent = 'Hello, ' + name + '!';
    document.getElementById('status').textContent = 'greeted';
  });
</script>
</body></html>`;

const LOGIN_PAGE = `<!doctype html><html><head><title>cPanel Login</title></head><body>
<h1>Log in</h1>
<form id="login-form" onsubmit="return false;">
  <input name="user" placeholder="Username" type="text">
  <input name="pass" placeholder="Password" type="password">
  <button type="submit">Log in</button>
</form>
<script>
  document.querySelector('button[type="submit"]').addEventListener('click', () => {
    document.body.innerHTML = '<h1>Dashboard</h1><a href="/logout">Log out</a><p>Welcome to cPanel</p>';
  });
</script>
</body></html>`;

const SECOND_PAGE = `<!doctype html><html><body><p id="second">second page</p></body></html>`;

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/login') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(LOGIN_PAGE);
    } else if (req.url === '/second') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(SECOND_PAGE);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FORM_PAGE);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ---------------------------------------------------------------------------
// Non-browser tests: always run.
// ---------------------------------------------------------------------------

test('URL guard refuses the cloud metadata address before any launch', async () => {
  const check = await checkUrlSafe('http://169.254.169.254/');
  assert.equal(check.ok, false);

  const engine = createBrowserEngine({ config: { browserEnabled: true }, logger });
  await assert.rejects(
    () => engine.open('http://169.254.169.254/'),
    /URL refused by safety check/,
  );
  assert.equal(engine.sessionCount(), 0, 'refused URL must not create a session');
  await engine.closeAll();
});

test('URL guard refuses non-http schemes and embedded credentials', async () => {
  assert.equal((await checkUrlSafe('file:///etc/passwd')).ok, false);
  assert.equal((await checkUrlSafe('http://user:pass@example.com/')).ok, false);
});

test('captcha detection flags challenge markers and ignores plain pages', () => {
  assert.equal(detectCaptcha('<html><body><h1>Hello</h1></body></html>'), false);
  assert.equal(detectCaptcha(''), false);
  assert.equal(detectCaptcha('<div class="g-recaptcha" data-sitekey="x"></div>'), true);
  assert.equal(detectCaptcha('<p>Please verify you are human to continue</p>'), true);
  assert.equal(detectCaptcha('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">'), true);
  assert.equal(detectCaptcha('<p>Complete the captcha challenge</p>'), true);
  assert.equal(CAPTCHA_ERROR, 'captcha detected — human assistance required');
});

test('disabled engine: isAvailable() is false and open() names the cause', async () => {
  const engine = createBrowserEngine({ config: { browserEnabled: false }, logger });
  assert.equal(engine.isAvailable(), false);
  await assert.rejects(() => engine.open(`${baseUrl}/`), /Browser is disabled/);
  await engine.closeAll();
});

test('close() on an unknown session throws a clear error; closeAll() never throws', async () => {
  const engine = createBrowserEngine({ config: { browserEnabled: false }, logger });
  await assert.rejects(() => engine.close('no-such-session'), /unknown browser session/);
  await assert.rejects(() => engine.navigate('no-such-session', `${baseUrl}/`), /unknown browser session/);
  await engine.closeAll(); // must not throw with zero sessions
});

// ---------------------------------------------------------------------------
// Browser tests: run only when a real Chromium is available; otherwise skip.
// ---------------------------------------------------------------------------

function browserTest(name, fn) {
  test(name, async (t) => {
    const engine = createBrowserEngine({ config: { browserEnabled: true }, logger });
    if (!engine.isAvailable()) {
      t.skip('no Chromium binary available in this environment (run: npx playwright install chromium)');
      return;
    }
    try {
      await fn(t, engine);
    } finally {
      await engine.closeAll();
    }
  });
}

browserTest('open/navigate/getText against the local test site', async (t, engine) => {
  const sessionId = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  assert.equal(typeof sessionId, 'string');
  assert.equal(engine.sessionCount(), 1);
  assert.equal(await engine.getText(sessionId, '#heading'), 'Hello Browser');
  assert.equal(await engine.getText(sessionId, '#status'), 'ready');

  await engine.navigate(sessionId, `${baseUrl}/second`, { allowPrivate: true });
  assert.equal(await engine.getText(sessionId, '#second'), 'second page');
  await engine.close(sessionId);
  assert.equal(engine.sessionCount(), 0);
});

browserTest('fill + click changes page text', async (t, engine) => {
  const sessionId = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  await engine.fill(sessionId, '#name-input', 'Nayem');
  await engine.click(sessionId, '#greet-btn');
  assert.equal(await engine.getText(sessionId, '#result'), 'Hello, Nayem!');
  assert.equal(await engine.getText(sessionId, '#status'), 'greeted');
  await engine.close(sessionId);
});

browserTest('screenshot returns a non-empty PNG buffer', async (t, engine) => {
  const sessionId = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  const shot = await engine.screenshot(sessionId);
  assert.ok(Buffer.isBuffer(shot));
  assert.ok(shot.length > 100, `screenshot too small: ${shot.length} bytes`);
  assert.deepEqual(shot.subarray(0, 8), PNG_MAGIC, 'screenshot is not a PNG');
  await engine.close(sessionId);
});

browserTest('unknown selector throws a clear error', async (t, engine) => {
  const sessionId = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  await assert.rejects(
    () => engine.click(sessionId, '#does-not-exist', { timeout: 1000 }),
    /selector not found within 1000ms: #does-not-exist/,
  );
  await assert.rejects(
    () => engine.getText(sessionId, '#does-not-exist', { timeout: 1000 }),
    /selector not found/,
  );
  await engine.close(sessionId);
});

browserTest('session cleanup closes contexts; closeAll empties the session list', async (t, engine) => {
  const a = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  const b = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  assert.equal(engine.sessionCount(), 2);
  await engine.close(a);
  assert.equal(engine.sessionCount(), 1);
  await engine.closeAll();
  assert.equal(engine.sessionCount(), 0);
  // A fresh session still works after closeAll (browser relaunches).
  const c = await engine.open(`${baseUrl}/`, { allowPrivate: true });
  assert.equal(await engine.getText(c, '#heading'), 'Hello Browser');
});

browserTest('cPanel helper: findField is resilient, loginFlow verifies login', async (t, engine) => {
  const sessionId = await engine.open(`${baseUrl}/login`, { allowPrivate: true });
  const page = engine.getPage(sessionId);

  // Placeholder-based match.
  const userField = await findField(page, ['Username', 'User Name']);
  assert.ok(userField, 'username field should be found');
  assert.match(userField.selector, /Username/);

  // Label-text fallback is exercised on the form page (label "Your name").
  await engine.navigate(sessionId, `${baseUrl}/`, { allowPrivate: true });
  const labelField = await findField(page, ['Your name']);
  assert.ok(labelField, 'field should be found via its <label> text');

  // Full login flow on the fake cPanel page.
  await engine.navigate(sessionId, `${baseUrl}/login`, { allowPrivate: true });
  const result = await loginFlow(sessionId, {
    url: `${baseUrl}/login`,
    username: 'demo-user',
    password: 'demo-pass-123',
    engine,
    allowPrivate: true,
  });
  assert.equal(result.ok, true);
  assert.match(result.evidence, /logout link|dashboard marker/);
  assert.ok(!JSON.stringify(result).includes('demo-pass-123'), 'password must never appear in the result');
});
