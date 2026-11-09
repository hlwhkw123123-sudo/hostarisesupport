// HTTP diagnostics: fetch with manual redirect following (max 5).
// Reports the final URL, status code, timing, server header, content-type
// and content length. Status: fail on 5xx / network error, warning on 4xx,
// ok on 2xx/3xx. Every URL is passed through the SSRF guard (checkUrlSafe)
// before it is fetched; a rejected URL is a 'fail' finding with the reason
// as evidence, never a silent skip.
// fetchUrl() is the shared low-level fetch used by the WordPress and
// resource checks so redirect/TTFB behaviour stays identical everywhere.
import { checkUrlSafe } from '../security.js';

export const CHECK_NAME = 'http';

const DEFAULT_MAX_REDIRECTS = 5;

// Low-level fetch: follows redirects manually (so the redirect chain is
// observable), measures time-to-first-byte and total time, and returns the
// response body as text. Never throws for HTTP-level outcomes; network
// failures and safety rejections are returned as { ok: false, error }.
export async function fetchUrl(rawUrl, { timeoutMs = 10000, maxRedirects = DEFAULT_MAX_REDIRECTS, allowPrivate = false } = {}) {
  const startedAt = Date.now();
  let url = String(rawUrl);
  let redirects = 0;

  for (;;) {
    const safe = await checkUrlSafe(url, { allowPrivate });
    if (!safe.ok) {
      return {
        ok: false,
        url,
        finalUrl: url,
        status: null,
        headers: {},
        text: null,
        sizeBytes: null,
        ttfbMs: null,
        totalMs: Date.now() - startedAt,
        redirects,
        error: `URL rejected by safety check: ${safe.reason}`,
        errorKind: 'unsafe-url',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const hopStart = Date.now();
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'HostariseDiagnostics/1.0' },
      });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err?.name === 'AbortError';
      return {
        ok: false,
        url,
        finalUrl: url,
        status: null,
        headers: {},
        text: null,
        sizeBytes: null,
        ttfbMs: null,
        totalMs: Date.now() - startedAt,
        redirects,
        error: timedOut ? `Request timed out after ${timeoutMs} ms` : `Fetch failed: ${err.message}`,
        errorKind: timedOut ? 'timeout' : 'network',
      };
    }
    const ttfbMs = Date.now() - hopStart;

    const headers = {
      server: res.headers.get('server'),
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      location: res.headers.get('location'),
    };

    // Redirect: follow (up to maxRedirects) without reading the body.
    if (res.status >= 300 && res.status < 400 && headers.location) {
      clearTimeout(timer);
      if (redirects >= maxRedirects) {
        return {
          ok: true,
          url,
          finalUrl: url,
          status: res.status,
          headers,
          text: null,
          sizeBytes: null,
          ttfbMs,
          totalMs: Date.now() - startedAt,
          redirects,
          error: `Redirect limit (${maxRedirects}) reached at ${url}`,
          errorKind: 'too-many-redirects',
        };
      }
      redirects += 1;
      try {
        url = new URL(headers.location, url).toString();
      } catch {
        return {
          ok: false,
          url,
          finalUrl: url,
          status: res.status,
          headers,
          text: null,
          sizeBytes: null,
          ttfbMs,
          totalMs: Date.now() - startedAt,
          redirects,
          error: `Redirect Location header is not a valid URL: ${headers.location}`,
          errorKind: 'bad-redirect',
        };
      }
      continue;
    }

    let text = null;
    let sizeBytes = null;
    try {
      const buf = await res.arrayBuffer();
      sizeBytes = buf.byteLength;
      text = Buffer.from(buf).toString('utf8');
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        url,
        finalUrl: url,
        status: res.status,
        headers,
        text: null,
        sizeBytes: null,
        ttfbMs,
        totalMs: Date.now() - startedAt,
        redirects,
        error: `Response body could not be read: ${err.message}`,
        errorKind: 'body',
      };
    }
    clearTimeout(timer);

    return {
      ok: true,
      url,
      finalUrl: url,
      status: res.status,
      headers,
      text,
      sizeBytes,
      ttfbMs,
      totalMs: Date.now() - startedAt,
      redirects,
      error: null,
      errorKind: null,
    };
  }
}

export async function checkHttp(rawUrl, { timeoutMs = 10000, maxRedirects = DEFAULT_MAX_REDIRECTS, allowPrivate = false } = {}) {
  const details = {
    url: String(rawUrl),
    finalUrl: null,
    statusCode: null,
    timingMs: null,
    redirects: null,
    server: null,
    contentType: null,
    contentLength: null,
  };
  const evidence = [];

  if (!rawUrl || typeof rawUrl !== 'string') {
    return { name: CHECK_NAME, status: 'unknown', details, evidence: ['No URL supplied for HTTP check.'] };
  }

  const result = await fetchUrl(rawUrl, { timeoutMs, maxRedirects, allowPrivate });

  details.finalUrl = result.finalUrl;
  details.statusCode = result.status;
  details.timingMs = result.totalMs;
  details.redirects = result.redirects;
  details.server = result.headers.server;
  details.contentType = result.headers.contentType;
  details.contentLength = result.headers.contentLength !== null && result.headers.contentLength !== undefined
    ? Number(result.headers.contentLength)
    : result.sizeBytes;

  if (!result.ok) {
    evidence.push(result.error);
    if (result.status !== null) evidence.push(`HTTP status observed before failure: ${result.status}`);
    return { name: CHECK_NAME, status: 'fail', details, evidence };
  }
  if (result.error) {
    // Redirect limit reached: the last status was observed, report it.
    evidence.push(result.error);
    evidence.push(`Final URL observed: ${result.finalUrl} (HTTP ${result.status})`);
    return { name: CHECK_NAME, status: 'warning', details, evidence };
  }

  evidence.push(`Final URL: ${result.finalUrl}`);
  evidence.push(`HTTP status: ${result.status}`);
  evidence.push(`Redirects followed: ${result.redirects}`);
  evidence.push(`Total time: ${result.totalMs} ms (time to first byte of final response: ${result.ttfbMs} ms)`);
  evidence.push(`Server header: ${result.headers.server ?? 'not present'}`);
  evidence.push(`Content-Type: ${result.headers.contentType ?? 'not present'}`);
  evidence.push(`Content length: ${details.contentLength ?? 'unknown'} bytes`);

  let status;
  if (result.status >= 500) status = 'fail';
  else if (result.status >= 400) status = 'warning';
  else status = 'ok';

  return { name: CHECK_NAME, status, details, evidence };
}
