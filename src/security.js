// Security helpers: SSRF guard, prompt-injection guard, path guard.
// These are the mandatory checks for every untrusted input (customer text,
// URLs from users, file paths from Telegram).
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);
const METADATA_IPS = new Set(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254']);

function isPrivateIp(ip) {
  if (net.isIP(ip) === 0) return false;
  if (METADATA_IPS.has(ip)) return true;
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254)
    );
  }
  // IPv6: loopback, link-local, unique-local
  const low = ip.toLowerCase();
  return low === '::1' || low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd');
}

// SSRF guard: returns { ok: true } or { ok: false, reason }.
// Blocks non-http(s) schemes, localhost/metadata hostnames, and hostnames
// that resolve to private/loopback/link-local/metadata IPs.
export async function checkUrlSafe(rawUrl, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http(s) URLs are allowed' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed' };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'blocked hostname' };
  if (allowPrivate) return { ok: true, url };
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: 'private IP address' };
    return { ok: true, url };
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return { ok: false, reason: 'hostname resolves to a private IP' };
    }
  } catch {
    return { ok: false, reason: 'hostname does not resolve' };
  }
  return { ok: true, url };
}

// Prompt-injection guard: flags text that tries to override system/agent
// instructions. Returns { flagged: boolean, matches: string[] }.
// Flagged input is NOT executed as an instruction; it is treated as data.
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (all )?(previous|prior|above) instructions/i,
  /you are now (a|an|the)/i,
  /new instructions?:/i,
  /system prompt/i,
  /reveal (your|the) (system|instructions|prompt)/i,
  /jailbreak/i,
  /do not (follow|obey) (your|the) (rules|instructions)/i,
];

export function checkPromptInjection(text) {
  const matches = [];
  if (typeof text !== 'string') return { flagged: false, matches };
  for (const pattern of INJECTION_PATTERNS) {
    const m = text.match(pattern);
    if (m) matches.push(m[0]);
  }
  return { flagged: matches.length > 0, matches };
}

// Path guard: resolve a user-supplied relative path inside baseDir only.
export function safeJoin(baseDir, userPath) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, userPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return { ok: false, reason: 'path escapes the allowed directory' };
  }
  return { ok: true, path: resolved };
}

// Role check: owner can do everything; team members only safe commands;
// everyone else gets nothing privileged.
export function getRole(userId, config) {
  if (config.ownerTelegramId && userId === config.ownerTelegramId) return 'owner';
  if (config.teamTelegramIds.includes(userId)) return 'team';
  return 'none';
}

export const PRIVILEGED_COMMANDS = new Set([
  'diagnose', 'browse', 'screenshot', 'test',
]);
