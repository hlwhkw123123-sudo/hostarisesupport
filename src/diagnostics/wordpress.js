// WordPress diagnostics, HTTP-based ONLY.
// Checks /wp-login.php, the <meta name="generator"> tag on the homepage and
// /wp-json/ availability, all through plain HTTP requests. Every finding
// states it is an HTTP observation, not server access: this module never
// reads files, databases, wp-config.php or server logs, and must never be
// presented as having done so.
import { fetchUrl } from './http.js';

export const CHECK_NAME = 'wordpress';

const HTTP_ONLY_NOTE = 'HTTP observation only: no server, file, or database access was used.';

function parseGenerator(html) {
  if (!html) return null;
  const match = html.match(/<meta\s+[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']generator["']/i);
  return match ? match[1].trim() : null;
}

export async function checkWordpress(baseUrl, { timeoutMs = 10000, allowPrivate = false } = {}) {
  const details = {
    siteUrl: String(baseUrl ?? ''),
    loginPage: null,
    generator: null,
    restApi: null,
    note: HTTP_ONLY_NOTE,
  };
  const evidence = [HTTP_ONLY_NOTE];

  if (!baseUrl || typeof baseUrl !== 'string') {
    return { name: CHECK_NAME, status: 'unknown', details, evidence: [...evidence, 'No site URL supplied for WordPress check.'] };
  }
  const base = baseUrl.replace(/\/+$/, '');

  // 1. Homepage: generator meta tag (version hint, if the site exposes it).
  const home = await fetchUrl(`${base}/`, { timeoutMs, allowPrivate });
  if (!home.ok || home.status === null) {
    evidence.push(`Homepage could not be fetched over HTTP: ${home.error || `HTTP ${home.status}`}`);
    return { name: CHECK_NAME, status: 'fail', details, evidence };
  }
  evidence.push(`Homepage fetched over HTTP: HTTP ${home.status} at ${home.finalUrl}.`);
  const generator = parseGenerator(home.text || '');
  if (generator) {
    details.generator = { found: true, value: generator };
    evidence.push(`Meta generator tag observed over HTTP: "${generator}".`);
  } else {
    details.generator = { found: false, value: null };
    evidence.push('No <meta name="generator"> tag observed on the homepage over HTTP.');
  }

  // 2. /wp-login.php existence (HTTP status only).
  const login = await fetchUrl(`${base}/wp-login.php`, { timeoutMs, allowPrivate });
  if (!login.ok && login.errorKind === 'unsafe-url') {
    details.loginPage = { exists: null, status: null };
    evidence.push(`/wp-login.php could not be checked: ${login.error}`);
  } else if (login.status === 200) {
    details.loginPage = { exists: true, status: 200 };
    evidence.push('/wp-login.php returned HTTP 200 over HTTP, so a WordPress login page appears to exist.');
  } else if (login.status === 404) {
    details.loginPage = { exists: false, status: 404 };
    evidence.push('/wp-login.php returned HTTP 404 over HTTP, so no WordPress login page was observed at that path.');
  } else {
    details.loginPage = { exists: null, status: login.status };
    evidence.push(`/wp-login.php returned HTTP ${login.status ?? 'unknown'} over HTTP (${login.error || 'no body read'}); existence is inconclusive from HTTP alone.`);
  }

  // 3. /wp-json/ availability (HTTP status + JSON shape only).
  const rest = await fetchUrl(`${base}/wp-json/`, { timeoutMs, allowPrivate });
  if (rest.ok && rest.status === 200) {
    let parsed = null;
    try { parsed = JSON.parse(rest.text || ''); } catch { parsed = null; }
    if (parsed && Array.isArray(parsed.namespaces)) {
      details.restApi = { available: true, status: 200, namespaces: parsed.namespaces };
      evidence.push(`/wp-json/ returned HTTP 200 with a WordPress REST API index over HTTP (namespaces: ${parsed.namespaces.join(', ')}).`);
    } else {
      details.restApi = { available: null, status: 200, namespaces: null };
      evidence.push('/wp-json/ returned HTTP 200 over HTTP but the body was not a recognisable WordPress REST API index; availability is inconclusive from HTTP alone.');
    }
  } else if (rest.status === 404) {
    details.restApi = { available: false, status: 404, namespaces: null };
    evidence.push('/wp-json/ returned HTTP 404 over HTTP, so no WordPress REST API was observed at that path.');
  } else {
    details.restApi = { available: null, status: rest.status, namespaces: null };
    evidence.push(`/wp-json/ check was inconclusive over HTTP: ${rest.error || `HTTP ${rest.status}`}.`);
  }

  const indicators = [
    details.generator?.found === true,
    details.loginPage?.exists === true,
    details.restApi?.available === true,
  ].filter(Boolean).length;

  let status;
  if (indicators > 0) status = 'ok';
  else if (home.status >= 500) status = 'fail';
  else status = 'warning';
  if (status === 'warning') {
    evidence.push('Site responded over HTTP but no WordPress indicators (generator tag, /wp-login.php, /wp-json/) were observed; this does not prove WordPress is absent, only that HTTP shows no sign of it.');
  }
  if (status === 'ok') {
    evidence.push(`${indicators} WordPress indicator(s) observed over HTTP.`);
  }

  return { name: CHECK_NAME, status, details, evidence };
}
