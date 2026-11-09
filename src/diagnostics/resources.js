// Server-resource / page-load diagnostics, fetch-based ONLY.
// Measures TTFB, total time and response size for one URL with a simple
// fetch. Browser-based load measurement (rendering, JavaScript execution,
// asset waterfall, on-load timing) belongs to the browser engine, not here,
// and this module never claims to have measured it.
import { fetchUrl } from './http.js';

export const CHECK_NAME = 'resources';

export const BROWSER_NOTE = 'Fetch-based measurement only: time to first byte, total fetch time and response size. Browser-based page-load measurement (rendering, JavaScript, asset waterfall) belongs to the browser engine, not this check.';

export async function checkResources(rawUrl, { timeoutMs = 10000, allowPrivate = false, slowThresholdMs = 5000 } = {}) {
  const details = {
    url: String(rawUrl ?? ''),
    finalUrl: null,
    statusCode: null,
    ttfbMs: null,
    totalMs: null,
    sizeBytes: null,
    server: null,
    contentType: null,
    note: BROWSER_NOTE,
  };
  const evidence = [BROWSER_NOTE];

  if (!rawUrl || typeof rawUrl !== 'string') {
    return { name: CHECK_NAME, status: 'unknown', details, evidence: [...evidence, 'No URL supplied for resource check.'] };
  }

  const result = await fetchUrl(rawUrl, { timeoutMs, allowPrivate });

  details.finalUrl = result.finalUrl;
  details.statusCode = result.status;
  details.ttfbMs = result.ttfbMs;
  details.totalMs = result.totalMs;
  details.sizeBytes = result.sizeBytes;
  details.server = result.headers.server;
  details.contentType = result.headers.contentType;

  if (!result.ok) {
    evidence.push(result.error);
    if (result.status !== null) evidence.push(`HTTP status observed before failure: ${result.status}`);
    return { name: CHECK_NAME, status: 'fail', details, evidence };
  }
  if (result.error) {
    evidence.push(result.error);
    return { name: CHECK_NAME, status: 'warning', details, evidence };
  }

  evidence.push(`Final URL: ${result.finalUrl}`);
  evidence.push(`HTTP status: ${result.status}`);
  evidence.push(`Time to first byte: ${result.ttfbMs} ms`);
  evidence.push(`Total fetch time: ${result.totalMs} ms`);
  evidence.push(`Response size: ${result.sizeBytes} bytes`);
  evidence.push(`Server header: ${result.headers.server ?? 'not present'}`);
  evidence.push(`Content-Type: ${result.headers.contentType ?? 'not present'}`);

  let status;
  if (result.status >= 500) status = 'fail';
  else if (result.status >= 400) status = 'warning';
  else if (result.totalMs > slowThresholdMs) status = 'warning';
  else status = 'ok';
  if (status === 'warning' && result.totalMs > slowThresholdMs) {
    evidence.push(`Total fetch time ${result.totalMs} ms exceeds the ${slowThresholdMs} ms slow threshold (fetch timing only, not browser render time).`);
  }

  return { name: CHECK_NAME, status, details, evidence };
}
