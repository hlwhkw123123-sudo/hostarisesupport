// DNS diagnostics: A, AAAA, MX, TXT, NS lookups via node:dns/promises,
// plus SPF / DMARC parsing from TXT records and DKIM presence.
// Every finding carries real evidence from the lookup, or status 'unknown'.
// Nothing here is invented: a record that was not observed is reported as
// not observed, never assumed.
import dns from 'node:dns/promises';

export const CHECK_NAME = 'dns';

// Run a promise with a timeout. Resolves { timeout: true } on expiry instead
// of rejecting, so a slow resolver degrades to 'unknown' rather than a crash.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// One guarded lookup: { value, error, timedOut }. Never throws.
async function tryLookup(fn, timeoutMs) {
  try {
    const result = await withTimeout(fn(), timeoutMs);
    if (result && result.__timeout) return { value: null, error: 'lookup timed out', timedOut: true };
    return { value: result, error: null, timedOut: false };
  } catch (err) {
    return { value: null, error: err.code || err.message || String(err), timedOut: false, code: err.code };
  }
}

// Parse an SPF TXT record ("v=spf1 ...") into its mechanisms and `all` rule.
export function parseSpfRecord(record) {
  const parts = String(record).trim().split(/\s+/).filter(Boolean);
  const mechanisms = parts.slice(1);
  const all = mechanisms.find((m) => /^[~\-+?]all$/.test(m)) || null;
  const includes = mechanisms.filter((m) => m.startsWith('include:')).map((m) => m.slice('include:'.length));
  return { record: String(record).trim(), mechanisms, includes, all };
}

// Parse a DMARC TXT record ("v=DMARC1; p=...; ...") into its tags.
export function parseDmarcRecord(record) {
  const tags = {};
  for (const part of String(record).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) { tags[trimmed] = ''; continue; }
    tags[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return {
    record: String(record).trim(),
    policy: tags.p || null,
    subdomainPolicy: tags.sp || null,
    pct: tags.pct || null,
    rua: tags.rua || null,
    ruf: tags.ruf || null,
    tags,
  };
}

// Flatten resolveTxt output (array of string arrays) into plain strings.
function flattenTxt(records) {
  return (records || []).map((entry) => (Array.isArray(entry) ? entry.join('') : String(entry)));
}

export async function checkDns(domain, { timeoutMs = 5000, dkimSelector = null } = {}) {
  const evidence = [];
  const errors = {};
  const details = {
    domain,
    a: null,
    aaaa: null,
    mx: null,
    ns: null,
    txt: null,
    spf: null,
    dmarc: null,
    dkim: null,
  };

  if (!domain || typeof domain !== 'string' || !domain.trim()) {
    return { name: CHECK_NAME, status: 'unknown', details, evidence: ['No domain supplied for DNS check.'] };
  }
  const host = domain.trim();

  const [a, aaaa, mx, ns, txt] = await Promise.all([
    tryLookup(() => dns.resolve4(host), timeoutMs),
    tryLookup(() => dns.resolve6(host), timeoutMs),
    tryLookup(() => dns.resolveMx(host), timeoutMs),
    tryLookup(() => dns.resolveNs(host), timeoutMs),
    tryLookup(() => dns.resolveTxt(host), timeoutMs),
  ]);

  if (a.value) { details.a = a.value; evidence.push(`A: ${a.value.join(', ')}`); }
  else { errors.a = a.error; evidence.push(`A: no records (${a.error})`); }
  if (aaaa.value) { details.aaaa = aaaa.value; evidence.push(`AAAA: ${aaaa.value.join(', ')}`); }
  else { errors.aaaa = aaaa.error; evidence.push(`AAAA: no records (${aaaa.error})`); }
  if (mx.value) {
    details.mx = [...mx.value].sort((x, y) => x.priority - y.priority)
      .map((r) => ({ exchange: r.exchange, priority: r.priority }));
    evidence.push(`MX: ${details.mx.map((r) => `${r.priority} ${r.exchange}`).join(', ')}`);
  } else { errors.mx = mx.error; evidence.push(`MX: no records (${mx.error})`); }
  if (ns.value) { details.ns = ns.value; evidence.push(`NS: ${ns.value.join(', ')}`); }
  else { errors.ns = ns.error; evidence.push(`NS: no records (${ns.error})`); }

  let txtStrings = [];
  if (txt.value) {
    txtStrings = flattenTxt(txt.value);
    details.txt = txtStrings;
    evidence.push(`TXT: ${txtStrings.length} record(s) observed`);
  } else { errors.txt = txt.error; evidence.push(`TXT: no records (${txt.error})`); }

  // SPF: TXT record starting with "v=spf1".
  const spfRecord = txtStrings.find((s) => s.trim().toLowerCase().startsWith('v=spf1'));
  if (spfRecord) {
    details.spf = { present: true, ...parseSpfRecord(spfRecord) };
    evidence.push(`SPF record found: ${spfRecord}`);
  } else {
    details.spf = { present: false, record: null, mechanisms: [], includes: [], all: null };
    evidence.push('SPF: no TXT record starting with v=spf1 was observed');
  }

  // DMARC: TXT record at _dmarc.<domain>.
  const dmarcLookup = await tryLookup(() => dns.resolveTxt(`_dmarc.${host}`), timeoutMs);
  if (dmarcLookup.value) {
    const dmarcStrings = flattenTxt(dmarcLookup.value);
    const dmarcRecord = dmarcStrings.find((s) => s.trim().toLowerCase().startsWith('v=dmarc1'));
    if (dmarcRecord) {
      details.dmarc = { present: true, ...parseDmarcRecord(dmarcRecord) };
      evidence.push(`DMARC record found: ${dmarcRecord}`);
    } else {
      details.dmarc = { present: false, record: null };
      evidence.push(`DMARC: _dmarc TXT records exist but none starts with v=DMARC1 (${dmarcStrings.join(' | ')})`);
    }
  } else {
    errors.dmarc = dmarcLookup.error;
    details.dmarc = { present: false, record: null };
    evidence.push(`DMARC: no _dmarc TXT record observed (${dmarcLookup.error})`);
  }

  // DKIM: only checkable with a selector. Without one, report that honestly.
  if (dkimSelector) {
    const selector = String(dkimSelector).trim();
    const dkimLookup = await tryLookup(() => dns.resolveTxt(`${selector}._domainkey.${host}`), timeoutMs);
    if (dkimLookup.value) {
      const dkimStrings = flattenTxt(dkimLookup.value);
      const dkimRecord = dkimStrings.find((s) => s.trim().toLowerCase().startsWith('v=dkim1'));
      details.dkim = {
        checked: true,
        selector,
        present: Boolean(dkimRecord),
        record: dkimRecord || null,
      };
      evidence.push(dkimRecord
        ? `DKIM: selector "${selector}" TXT record found: ${dkimRecord}`
        : `DKIM: selector "${selector}" TXT records exist but none starts with v=DKIM1`);
    } else {
      errors.dkim = dkimLookup.error;
      details.dkim = { checked: true, selector, present: false, record: null };
      evidence.push(`DKIM: no TXT record observed for selector "${selector}" (${dkimLookup.error})`);
    }
  } else {
    details.dkim = { checked: false, selector: null, present: null, record: null };
    evidence.push('DKIM: selector not checked without a selector (no DKIM selector was supplied)');
  }

  details.errors = errors;

  const hasAddress = Boolean(details.a || details.aaaa);
  const hasAnything = hasAddress || Boolean(details.mx || details.ns);
  const allTimedOut = [a, aaaa, mx, ns, txt].every((r) => r.timedOut);
  const allNotFound = [a, aaaa, mx, ns, txt].every((r) => r.code === 'ENOTFOUND');

  let status;
  if (hasAddress) status = 'ok';
  else if (hasAnything) status = 'warning';
  else if (allTimedOut) status = 'unknown';
  else if (allNotFound) status = 'fail';
  else status = 'unknown';

  return { name: CHECK_NAME, status, details, evidence };
}
