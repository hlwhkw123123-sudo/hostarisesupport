// Logger with secret redaction. Every log line passes through redact().
// Secret values themselves are never logged; known secret patterns are
// replaced with [REDACTED]. Add a value to extraSecrets to redact it too.
const SECRET_PATTERNS = [
  /bot\d{6,}:[A-Za-z0-9_-]{30,}/g, // Telegram bot token shape
  /AIza[0-9A-Za-z_-]{20,}/g, // Google/Gemini API key shape
  /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/gi,
  /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function redact(input, extraSecrets = []) {
  if (input === undefined || input === null) return input;
  let text = typeof input === 'string' ? input : JSON.stringify(input);
  for (const secret of extraSecrets) {
    if (secret && typeof secret === 'string' && secret.length > 3) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

export function createLogger({ level = 'info', extraSecrets = [] } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, meta) => {
    if ((LEVELS[lvl] ?? 99) < min) return;
    const line = { ts: new Date().toISOString(), level: lvl, msg: redact(msg, extraSecrets) };
    if (meta !== undefined) line.meta = redact(meta, extraSecrets);
    const out = lvl === 'error' ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + '\n');
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}
