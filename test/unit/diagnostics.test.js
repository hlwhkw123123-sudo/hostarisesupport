// Diagnostics engine tests (Milestone 7).
// Uses a LOCAL node:http server for all deterministic assertions. The only
// public-host checks are example.com (DNS happy path + SSL), which assert
// 'unknown'/'fail' handling when the network is unavailable instead of
// assuming connectivity.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { runDiagnostics, ALL_CHECKS } from '../../src/diagnostics/index.js';
import { checkDns, parseSpfRecord, parseDmarcRecord } from '../../src/diagnostics/dns.js';
import { checkSsl } from '../../src/diagnostics/ssl.js';
import { checkHttp } from '../../src/diagnostics/http.js';
import { checkEmail } from '../../src/diagnostics/email.js';
import { checkWordpress } from '../../src/diagnostics/wordpress.js';
import { checkResources } from '../../src/diagnostics/resources.js';

const WP_PAGE = '<!doctype html><html><head><meta name="generator" content="WordPress 6.5" /></head><body>hello</body></html>';
const PLAIN_PAGE = '<!doctype html><html><head><title>Plain</title></head><body>plain site</body></html>';
const LOGIN_PAGE = '<!doctype html><html><body><form id="loginform">log in</form></body></html>';

let server;
let port;
let baseUrl;

// The sandbox DNS proxy answers A queries for every well-formed name, so a
// ".invalid" name does NOT fail here. A 64-char label is rejected locally
// by the resolver (EBADNAME) with no network involved, which makes it a
// deterministic unresolvable hostname in any environment.
const UNRESOLVABLE_DOMAIN = `${'a'.repeat(64)}.invalid`;

test.before(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('Server', 'TestServer/1.0');
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(WP_PAGE);
    } else if (path === '/wp-login.php') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(LOGIN_PAGE);
    } else if (path === '/wp-json/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ namespaces: ['wp/v2', 'oembed/1.0'] }));
    } else if (path === '/redirect') {
      res.writeHead(302, { Location: '/final' });
      res.end();
    } else if (path === '/final') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>final page</body></html>');
    } else if (path === '/notfound') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } else if (path === '/error') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('server error');
    } else if (path === '/plain/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PLAIN_PAGE);
    } else if (path === '/plain/wp-login.php' || path === '/plain/wp-json/') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const STATUSES = ['ok', 'warning', 'fail', 'unknown'];

function assertCheckShape(result, name) {
  assert.equal(result.name, name);
  assert.ok(STATUSES.includes(result.status), `status ${result.status} must be one of ${STATUSES}`);
  assert.equal(typeof result.details, 'object');
  assert.ok(Array.isArray(result.evidence) && result.evidence.length > 0, 'evidence must be a non-empty array');
}

// --- DNS parsing (pure, no network) ---

test('dns: parseSpfRecord extracts mechanisms and the all rule', () => {
  const parsed = parseSpfRecord('v=spf1 include:_spf.google.com include:spf.example.net -all');
  assert.equal(parsed.record, 'v=spf1 include:_spf.google.com include:spf.example.net -all');
  assert.deepEqual(parsed.includes, ['_spf.google.com', 'spf.example.net']);
  assert.equal(parsed.all, '-all');
  assert.ok(parsed.mechanisms.includes('include:_spf.google.com'));
});

test('dns: parseDmarcRecord extracts policy tags', () => {
  const parsed = parseDmarcRecord('v=DMARC1; p=reject; sp=quarantine; pct=100; rua=mailto:dmarc@example.com');
  assert.equal(parsed.policy, 'reject');
  assert.equal(parsed.subdomainPolicy, 'quarantine');
  assert.equal(parsed.pct, '100');
  assert.equal(parsed.rua, 'mailto:dmarc@example.com');
});

// --- DNS live lookups ---

test('dns: example.com happy path when network is available, unknown/fail handling otherwise', async () => {
  const result = await checkDns('example.com', { timeoutMs: 8000 });
  assertCheckShape(result, 'dns');
  if (result.status === 'ok') {
    assert.ok(Array.isArray(result.details.a) && result.details.a.length > 0, 'ok DNS result must carry A records');
    assert.ok(result.evidence.some((e) => e.startsWith('DKIM: selector not checked')));
  } else {
    // No network (or resolver failure): the check must degrade, not crash.
    assert.ok(['unknown', 'fail', 'warning'].includes(result.status));
  }
});

test('dns: DKIM is only reported as not-checked without a selector', async () => {
  const result = await checkDns('example.com', { timeoutMs: 8000 });
  assert.equal(result.details.dkim.checked, false);
  assert.equal(result.details.dkim.present, null);
});

test('dns: non-existent domain returns fail/unknown, never throws', async () => {
  const result = await checkDns(UNRESOLVABLE_DOMAIN, { timeoutMs: 8000 });
  assertCheckShape(result, 'dns');
  assert.ok(['fail', 'unknown'].includes(result.status), `expected fail/unknown, got ${result.status}`);
  assert.equal(result.details.a, null);
});

// --- SSL ---

test('ssl: example.com certificate when network is available, unknown/fail handling otherwise', async () => {
  const result = await checkSsl('example.com', { timeoutMs: 10000 });
  assertCheckShape(result, 'ssl');
  if (result.status === 'ok' || result.status === 'warning') {
    assert.equal(typeof result.details.expiry, 'string');
    assert.equal(typeof result.details.daysRemaining, 'number');
    assert.ok(result.details.daysRemaining > 0, 'example.com certificate must not be expired');
    assert.ok(result.details.issuer && typeof result.details.issuer === 'object');
    assert.ok(Number.isInteger(result.details.chainCount) && result.details.chainCount >= 1);
  } else {
    assert.ok(['unknown', 'fail'].includes(result.status));
  }
});

test('ssl: non-existent host returns unknown, never throws', async () => {
  const result = await checkSsl(UNRESOLVABLE_DOMAIN, { timeoutMs: 8000 });
  assertCheckShape(result, 'ssl');
  assert.ok(['unknown', 'fail'].includes(result.status));
  assert.equal(result.details.daysRemaining, null);
});

// --- HTTP (local server) ---

test('http: 200 against local server is ok with headers and timing', async () => {
  const result = await checkHttp(`${baseUrl}/`, { timeoutMs: 5000, allowPrivate: true });
  assertCheckShape(result, 'http');
  assert.equal(result.status, 'ok');
  assert.equal(result.details.statusCode, 200);
  assert.equal(result.details.finalUrl, `${baseUrl}/`);
  assert.equal(result.details.server, 'TestServer/1.0');
  assert.ok(result.details.contentType.includes('text/html'));
  assert.equal(typeof result.details.timingMs, 'number');
  assert.ok(result.details.timingMs >= 0);
  assert.ok(result.details.contentLength > 0);
});

test('http: 404 is warning, 500 is fail', async () => {
  const notFound = await checkHttp(`${baseUrl}/notfound`, { timeoutMs: 5000, allowPrivate: true });
  assert.equal(notFound.status, 'warning');
  assert.equal(notFound.details.statusCode, 404);

  const error = await checkHttp(`${baseUrl}/error`, { timeoutMs: 5000, allowPrivate: true });
  assert.equal(error.status, 'fail');
  assert.equal(error.details.statusCode, 500);
});

test('http: redirect is followed to the final URL (max 5)', async () => {
  const result = await checkHttp(`${baseUrl}/redirect`, { timeoutMs: 5000, allowPrivate: true });
  assert.equal(result.status, 'ok');
  assert.equal(result.details.statusCode, 200);
  assert.equal(result.details.finalUrl, `${baseUrl}/final`);
  assert.equal(result.details.redirects, 1);
});

test('http: SSRF guard blocks metadata/private URLs and local loopback without allowPrivate', async () => {
  const metadata = await checkHttp('http://169.254.169.254/', { timeoutMs: 5000 });
  assert.equal(metadata.status, 'fail');
  assert.ok(metadata.evidence.some((e) => e.includes('safety check')), 'evidence must cite the safety check');

  const loopback = await checkHttp(`${baseUrl}/`, { timeoutMs: 5000 });
  assert.equal(loopback.status, 'fail');
  assert.ok(loopback.evidence.some((e) => e.includes('safety check')));
});

test('http: unresolvable host is fail, never throws', async () => {
  const result = await checkHttp(`https://${UNRESOLVABLE_DOMAIN}/`, { timeoutMs: 8000 });
  assertCheckShape(result, 'http');
  assert.equal(result.status, 'fail');
});

// --- Email ---

test('email: non-existent MX domain returns fail/unknown, never throws, never sends mail', async () => {
  const result = await checkEmail(UNRESOLVABLE_DOMAIN, { timeoutMs: 8000 });
  assertCheckShape(result, 'email');
  assert.ok(['fail', 'unknown'].includes(result.status), `expected fail/unknown, got ${result.status}`);
  assert.equal(result.details.mx, null);
  assert.equal(result.details.reachable, null);
  assert.equal(result.details.banner, null);
});

// --- WordPress (local server) ---

test('wordpress: local WordPress-like site shows login page, generator and REST API', async () => {
  const result = await checkWordpress(baseUrl, { timeoutMs: 5000, allowPrivate: true });
  assertCheckShape(result, 'wordpress');
  assert.equal(result.status, 'ok');
  assert.equal(result.details.loginPage.exists, true);
  assert.equal(result.details.loginPage.status, 200);
  assert.equal(result.details.generator.found, true);
  assert.equal(result.details.generator.value, 'WordPress 6.5');
  assert.equal(result.details.restApi.available, true);
  assert.deepEqual(result.details.restApi.namespaces, ['wp/v2', 'oembed/1.0']);
  assert.ok(result.evidence.some((e) => e.includes('HTTP observation only')), 'findings must state they are HTTP observations');
});

test('wordpress: plain non-WordPress site is warning with no indicators', async () => {
  const result = await checkWordpress(`${baseUrl}/plain`, { timeoutMs: 5000, allowPrivate: true });
  assertCheckShape(result, 'wordpress');
  assert.equal(result.status, 'warning');
  assert.equal(result.details.generator.found, false);
  assert.equal(result.details.loginPage.exists, false);
  assert.equal(result.details.restApi.available, false);
});

test('wordpress: unreachable site is fail, never throws', async () => {
  const result = await checkWordpress(`https://${UNRESOLVABLE_DOMAIN}`, { timeoutMs: 8000 });
  assertCheckShape(result, 'wordpress');
  assert.equal(result.status, 'fail');
});

// --- Resources (local server) ---

test('resources: local page measures TTFB, total time and size, and states the browser limit', async () => {
  const result = await checkResources(`${baseUrl}/`, { timeoutMs: 5000, allowPrivate: true });
  assertCheckShape(result, 'resources');
  assert.equal(result.status, 'ok');
  assert.equal(result.details.statusCode, 200);
  assert.equal(typeof result.details.ttfbMs, 'number');
  assert.ok(result.details.ttfbMs >= 0);
  assert.equal(typeof result.details.totalMs, 'number');
  assert.ok(result.details.totalMs >= result.details.ttfbMs);
  assert.ok(result.details.sizeBytes > 0);
  assert.ok(result.details.note.includes('browser engine'));
});

// --- Aggregator ---

test('runDiagnostics: aggregates mixed local results without throwing', async () => {
  const result = await runDiagnostics('127.0.0.1', {
    checks: ['http', 'wordpress', 'resources'],
    timeoutMs: 5000,
    allowPrivate: true,
    baseUrl,
    url: `${baseUrl}/`,
  });
  assert.equal(result.domain, '127.0.0.1');
  assert.equal(typeof result.startedAt, 'string');
  assert.equal(result.checks.length, 3);
  assert.deepEqual(result.checks.map((c) => c.name), ['http', 'wordpress', 'resources']);
  for (const check of result.checks) assertCheckShape(check, check.name);
  assert.equal(result.summary.total, 3);
  assert.equal(
    result.summary.ok + result.summary.warning + result.summary.fail + result.summary.unknown,
    3,
  );
  assert.equal(result.summary.ok, 3);
});

test('runDiagnostics: all checks against a non-existent domain never throw', async () => {
  const result = await runDiagnostics(UNRESOLVABLE_DOMAIN, { timeoutMs: 8000 });
  assert.deepEqual(result.checks.map((c) => c.name), ALL_CHECKS);
  assert.equal(result.summary.total, ALL_CHECKS.length);
  assert.equal(
    result.summary.ok + result.summary.warning + result.summary.fail + result.summary.unknown,
    ALL_CHECKS.length,
  );
  for (const check of result.checks) {
    assertCheckShape(check, check.name);
    assert.ok(['fail', 'unknown', 'warning'].includes(check.status), `${check.name} must not claim ok for a non-existent domain`);
  }
  assert.equal(result.summary.ok, 0);
});

test('runDiagnostics: unknown check name is recorded as unknown, not thrown', async () => {
  const result = await runDiagnostics('example.com', { checks: ['bogus-check'], timeoutMs: 5000 });
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].name, 'bogus-check');
  assert.equal(result.checks[0].status, 'unknown');
  assert.equal(result.summary.unknown, 1);
});

test('runDiagnostics: empty domain records every requested check as unknown', async () => {
  const result = await runDiagnostics('', { checks: ['dns', 'ssl'] });
  assert.equal(result.checks.length, 2);
  assert.ok(result.checks.every((c) => c.status === 'unknown'));
  assert.equal(result.summary.unknown, 2);
});
