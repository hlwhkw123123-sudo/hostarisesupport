// SSL/TLS diagnostics: fetch the live certificate via node:tls.
// Reports expiry date, days remaining, issuer, subject and chain count.
// Status: fail if expired, warning if < 30 days remain, ok otherwise.
// A host that cannot be reached (or presents no certificate) is 'unknown'
// with the real error as evidence, never an invented certificate.
import tls from 'node:tls';

export const CHECK_NAME = 'ssl';

function unknown(details, evidence) {
  return { name: CHECK_NAME, status: 'unknown', details, evidence };
}

export async function checkSsl(domain, { port = 443, timeoutMs = 10000 } = {}) {
  const details = {
    domain,
    port,
    expiry: null,
    validFrom: null,
    daysRemaining: null,
    issuer: null,
    subject: null,
    chainCount: null,
    expired: null,
  };

  if (!domain || typeof domain !== 'string' || !domain.trim()) {
    return unknown(details, ['No domain supplied for SSL check.']);
  }
  const host = domain.trim();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* already closed */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(unknown(details, [`TLS connection to ${host}:${port} timed out after ${timeoutMs} ms.`]));
    }, timeoutMs);

    let socket;
    try {
      socket = tls.connect({
        host,
        port,
        servername: host,
        // We report on the certificate as presented, including expired or
        // self-signed ones, so verification must not abort the handshake.
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
    } catch (err) {
      finish(unknown(details, [`Could not start TLS connection to ${host}:${port}: ${err.message}`]));
      return;
    }

    socket.once('secureConnect', () => {
      let cert;
      try {
        cert = socket.getPeerCertificate(true);
      } catch (err) {
        finish(unknown(details, [`TLS connected but the peer certificate could not be read: ${err.message}`]));
        return;
      }
      if (!cert || Object.keys(cert).length === 0) {
        finish(unknown(details, [`TLS connected to ${host}:${port} but no certificate was presented.`]));
        return;
      }

      // Walk the issuerCertificate chain, guarding against self-signed loops.
      let chainCount = 0;
      const seen = new Set();
      let node = cert;
      while (node && Object.keys(node).length > 0 && !seen.has(node)) {
        seen.add(node);
        chainCount += 1;
        const next = node.issuerCertificate;
        if (!next || next === node) break;
        node = next;
      }

      const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
      const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
      const daysRemaining = validTo && !Number.isNaN(validTo.getTime())
        ? Math.floor((validTo.getTime() - Date.now()) / 86400000)
        : null;

      details.expiry = validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null;
      details.validFrom = validFrom && !Number.isNaN(validFrom.getTime()) ? validFrom.toISOString() : null;
      details.daysRemaining = daysRemaining;
      details.issuer = cert.issuer || null;
      details.subject = cert.subject || null;
      details.chainCount = chainCount;
      details.expired = daysRemaining !== null ? daysRemaining < 0 : null;

      const evidence = [
        `Certificate subject: ${cert.subject?.CN || JSON.stringify(cert.subject || {})}`,
        `Certificate issuer: ${cert.issuer?.CN || cert.issuer?.O || JSON.stringify(cert.issuer || {})}`,
        `Valid from: ${details.validFrom || 'not stated in certificate'}`,
        `Valid to: ${details.expiry || 'not stated in certificate'}`,
        `Days remaining: ${daysRemaining === null ? 'unknown (no expiry in certificate)' : daysRemaining}`,
        `Certificate chain length observed: ${chainCount}`,
      ];

      let status;
      if (daysRemaining === null) status = 'unknown';
      else if (daysRemaining < 0) status = 'fail';
      else if (daysRemaining < 30) status = 'warning';
      else status = 'ok';
      if (status === 'fail') evidence.push(`Certificate expired ${-daysRemaining} day(s) ago.`);
      if (status === 'warning') evidence.push('Certificate expires in fewer than 30 days.');

      finish({ name: CHECK_NAME, status, details, evidence });
    });

    socket.once('error', (err) => {
      finish(unknown(details, [`TLS connection to ${host}:${port} failed: ${err.code || err.message}`]));
    });
    socket.once('timeout', () => {
      finish(unknown(details, [`TLS connection to ${host}:${port} timed out after ${timeoutMs} ms.`]));
    });
  });
}
