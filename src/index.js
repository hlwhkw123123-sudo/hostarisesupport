// Hostarise AI Agent — entry point.
// Starts the Telegram bot (live or mock), wires the AI engine, knowledge
// base, diagnostics, browser engine, replies, operations and task manager.
// Graceful shutdown on SIGINT/SIGTERM.
import { loadConfig, validateConfig } from './config.js';
import { createLogger, redact } from './logger.js';
import { TaskManager } from './tasks/manager.js';
import { createBot } from './telegram/bot.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  logger.info('Hostarise AI Agent starting', { mockMode: config.mockMode });

  const { ok, errors } = validateConfig(config);
  if (!ok) {
    for (const e of errors) logger.error(`config error: ${e}`);
    logger.error('Startup blocked: fix the configuration (see .env.example). Exiting.');
    process.exit(1);
  }
  if (config.mockMode) {
    logger.warn('Running in MOCK MODE: no real Telegram/Gemini calls will be made.');
  }

  const tasks = new TaskManager({ dataDir: config.dataDir, logger });
  await tasks.load();

  const bot = createBot({ config, logger, tasks });
  await bot.start();

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}; shutting down gracefully...`);
    try { await bot.stop(); } catch (err) { logger.error(`bot stop error: ${err.message}`); }
    logger.info('Shutdown complete.');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // Redact before printing: a raw error could contain a secret.
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: redact(`fatal startup error: ${err.message}`) }));
  process.exit(1);
});
