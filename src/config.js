// Config: loads and validates environment variables.
// Live credentials are required ONLY in live mode (MOCK_MODE != "true").
// Never log secret values; validation reports only which keys are missing.
import 'dotenv/config';

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

function envInt(name, fallback) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const mockMode = env.MOCK_MODE === undefined ? true : (env.MOCK_MODE === 'true' || env.MOCK_MODE === '1');
  const config = {
    mockMode,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    geminiApiKey: env.GEMINI_API_KEY || '',
    ownerTelegramId: env.OWNER_TELEGRAM_ID ? Number(env.OWNER_TELEGRAM_ID) : null,
    teamTelegramIds: (env.TEAM_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n)),
    browserEnabled: env.BROWSER_ENABLED === undefined ? true : envBool('BROWSER_ENABLED', true),
    geminiModel: env.GEMINI_MODEL || 'gemini-1.5-flash',
    geminiTimeoutMs: envInt('GEMINI_TIMEOUT_MS', 60000),
    dataDir: env.DATA_DIR || './data',
    logLevel: env.LOG_LEVEL || 'info',
  };
  return config;
}

// Returns { ok, errors[] }. Live mode requires bot token + Gemini key.
// Mock mode requires nothing.
export function validateConfig(config) {
  const errors = [];
  if (!config.mockMode) {
    if (!config.telegramBotToken) errors.push('TELEGRAM_BOT_TOKEN is required in live mode');
    if (!config.geminiApiKey) errors.push('GEMINI_API_KEY is required in live mode');
  }
  if (!config.ownerTelegramId && !config.mockMode) {
    errors.push('OWNER_TELEGRAM_ID is required in live mode (who may run privileged commands)');
  }
  return { ok: errors.length === 0, errors };
}

// Names of env vars that must never appear in logs.
export const SECRET_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY'];
