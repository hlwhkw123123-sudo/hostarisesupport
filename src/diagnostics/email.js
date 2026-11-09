// Email / SMTP diagnostics: MX lookup + a plain TCP connect to port 25 of
// the first (lowest-priority) MX host, reading the SMTP banner and sending
// EHLO. NEVER sends mail: no MAIL FROM / RCPT TO is ever issued, and the
// session is closed with QUIT. Reports reachable / unreachable with the real
// banner or the real connection error as evidence.
import dns from 'node:dns/promises';
import net from 'node:net';

export const CHECK_NAME = 'email';

export async function checkEmail(domain, { timeoutMs = 5000, ehlo = true } = {}) {
  const details = {
    domain,
    mx: null,
    mxHost: null,
    mxPriority: null,
    reachable: null,
    banner: null,
    ehloResponse: null,
    port: 25,
  };
  const evidence = [];

  if (!domain || typeof domain !== 'string' || !domain.trim()) {
    return { name: CHECK_NAME, status: 'unknown', details, evidence: ['No domain supplied for email check.'] };
  }
  const host = domain.trim();

  // MX lookup.
  let mxRecords;
  try {
    mxRecords = await dns.resolveMx(host);
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      evidence.push(`MX lookup: no MX records found for ${host} (${err.code}).`);
      return { name: CHECK_NAME, status: 'fail', details, evidence };
    }
    evidence.push(`MX lookup failed for ${host}: ${err.code || err.message}`);
    return { name: CHECK_NAME, status: 'unknown', details, evidence };
  }
  if (!mxRecords || mxRecords.length === 0) {
    evidence.push(`MX lookup: no MX records found for ${host}.`);
    return { name: CHECK_NAME, status: 'fail', details, evidence };
  }
  const sorted = [...mxRecords].sort((a, b) => a.priority - b.priority);
  details.mx = sorted.map((r) => ({ exchange: r.exchange, priority: r.priority }));
  const first = sorted[0];
  details.mxHost = first.exchange;
  details.mxPriority = first.priority;
  evidence.push(`MX: ${sorted.map((r) => `${r.priority} ${r.exchange}`).join(', ')}`);
  evidence.push(`Testing TCP connect to port 25 of first MX host: ${first.exchange}`);

  // TCP connect to port 25. Read banner, optionally EHLO, then QUIT.
  // No mail is ever sent.
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status, extraEvidence) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* already closed */ }
      resolve({ name: CHECK_NAME, status, details, evidence: [...evidence, ...extraEvidence] });
    };

    const timer = setTimeout(() => {
      finish('unknown', [`TCP connect to ${first.exchange}:25 timed out after ${timeoutMs} ms (firewall or filtering may block port 25; not treated as proof the server is down).`]);
    }, timeoutMs);

    const socket = net.createConnection({ host: first.exchange, port: 25 });
    socket.setEncoding('utf8');
    let buffer = '';
    let bannerSeen = false;
    let ehloSent = false;
    let ehloDone = false;

    socket.on('connect', () => {
      evidence.push(`TCP connection to ${first.exchange}:25 established.`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      // Process complete lines as they arrive.
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!bannerSeen) {
          bannerSeen = true;
          details.banner = line;
          evidence.push(`SMTP banner: ${line}`);
          if (ehlo && !ehloSent) {
            ehloSent = true;
            socket.write('EHLO hostarise-diagnostics\r\n');
          } else {
            details.reachable = true;
            socket.write('QUIT\r\n');
            finish('ok', ['SMTP banner received; session closed with QUIT. No mail was sent.']);
          }
        } else if (ehloSent && !ehloDone) {
          // EHLO replies are multi-line (250-... / 250 ...). Collect until
          // the final "250 " line.
          details.ehloResponse = details.ehloResponse ? `${details.ehloResponse}\n${line}` : line;
          if (/^250[ -]/.test(line) && !line.startsWith('250-')) {
            ehloDone = true;
            details.reachable = true;
            evidence.push(`EHLO response: ${details.ehloResponse.replace(/\n/g, ' | ')}`);
            socket.write('QUIT\r\n');
            finish('ok', ['SMTP server accepted EHLO; session closed with QUIT. No mail was sent.']);
          }
        }
      }
    });

    socket.on('error', (err) => {
      finish('fail', [`TCP connect to ${first.exchange}:25 failed: ${err.code || err.message}`]);
    });

    socket.on('close', () => {
      if (!settled) {
        if (bannerSeen) {
          details.reachable = true;
          finish('ok', ['SMTP banner was received before the server closed the connection. No mail was sent.']);
        } else {
          finish('fail', [`Connection to ${first.exchange}:25 closed without an SMTP banner.`]);
        }
      }
    });
  });
}
