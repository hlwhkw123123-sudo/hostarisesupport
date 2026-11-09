// Technical Diagnostics Engine — aggregator (Milestone 7).
// runDiagnostics(domain, { checks, timeoutMs }) runs the requested checks
// (default: all) and never throws on a single check failure: a failing check
// is recorded as fail/unknown with its evidence and the run continues.
// Every check result carries real evidence or status 'unknown'; findings
// are never invented. See SPEC.md §3D and §3B (unknown = unknown).
import { checkDns } from './dns.js';
import { checkSsl } from './ssl.js';
import { checkHttp } from './http.js';
import { checkEmail } from './email.js';
import { checkWordpress } from './wordpress.js';
import { checkResources } from './resources.js';

export const ALL_CHECKS = ['dns', 'ssl', 'http', 'email', 'wordpress', 'resources'];

export const STATUSES = ['ok', 'warning', 'fail', 'unknown'];

// Each runner receives (domain, options) and returns a check result.
// URL-based checks take their URL from options.url / options.baseUrl when
// supplied (used by tests against a local server), otherwise from the domain.
const RUNNERS = {
  dns: (domain, opts) => checkDns(domain, opts),
  ssl: (domain, opts) => checkSsl(domain, opts),
  http: (domain, opts) => checkHttp(opts.url || `https://${domain}/`, opts),
  email: (domain, opts) => checkEmail(domain, opts),
  wordpress: (domain, opts) => checkWordpress(opts.baseUrl || opts.url || `https://${domain}`, opts),
  resources: (domain, opts) => checkResources(opts.url || `https://${domain}/`, opts),
};

export async function runDiagnostics(domain, options = {}) {
  const {
    checks = ALL_CHECKS,
    timeoutMs = 10000,
    ...checkOptions
  } = options;
  const startedAt = new Date().toISOString();
  const requested = Array.isArray(checks) ? checks : ALL_CHECKS;
  const results = [];

  if (!domain || typeof domain !== 'string' || !domain.trim()) {
    for (const name of requested) {
      results.push({
        name,
        status: 'unknown',
        details: {},
        evidence: ['No domain supplied for diagnostics.'],
      });
    }
    return { domain: domain ?? null, startedAt, checks: results, summary: summarise(results) };
  }

  for (const name of requested) {
    const runner = RUNNERS[name];
    if (!runner) {
      results.push({
        name,
        status: 'unknown',
        details: {},
        evidence: [`Unknown check name: ${name}`],
      });
      continue;
    }
    try {
      const result = await runner(domain.trim(), { timeoutMs, ...checkOptions });
      results.push(normalise(name, result));
    } catch (err) {
      // A single check must never abort the whole run.
      results.push({
        name,
        status: 'unknown',
        details: { error: err?.message || String(err) },
        evidence: [`Check "${name}" threw unexpectedly and was recorded as unknown: ${err?.message || String(err)}`],
      });
    }
  }

  return { domain: domain.trim(), startedAt, checks: results, summary: summarise(results) };
}

function normalise(name, result) {
  if (!result || typeof result !== 'object') {
    return { name, status: 'unknown', details: {}, evidence: [`Check "${name}" returned no result.`] };
  }
  return {
    name: result.name || name,
    status: STATUSES.includes(result.status) ? result.status : 'unknown',
    details: result.details && typeof result.details === 'object' ? result.details : {},
    evidence: Array.isArray(result.evidence) && result.evidence.length > 0
      ? result.evidence
      : ['No evidence recorded for this check.'],
  };
}

function summarise(results) {
  const summary = { total: results.length, ok: 0, warning: 0, fail: 0, unknown: 0 };
  for (const r of results) {
    if (Object.hasOwn(summary, r.status)) summary[r.status] += 1;
    else summary.unknown += 1;
  }
  return summary;
}
