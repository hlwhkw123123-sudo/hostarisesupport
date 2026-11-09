// Telegram bot wiring (Milestone 3).
//
// createBot({ config, logger, tasks }) -> { start(), stop(), bot }
//
// Live mode: a real grammY Bot using config.telegramBotToken, with all 13
// commands from handlers.js plus plain-text handling, and a bot.catch()
// that logs redacted errors (never leaks them to Telegram).
// Mock mode (config.mockMode): NO call to Telegram is ever made. The
// returned bot is a small in-process stand-in exposing the same
// command()/on()/catch()/start()/stop() surface grammY provides, with the
// same handlers registered, so tests and local runs can exercise the
// command surface without credentials. start()/stop() only log and
// resolve.
//
// Graceful stop: stop() is idempotent and safe to call before start().
import { Bot } from 'grammy';
import { createHandlers, COMMANDS } from './handlers.js';
import { redact } from '../logger.js';

function registerBot(bot, handlers, logger) {
  for (const name of COMMANDS) {
    bot.command(name, handlers[name]);
  }
  bot.on('message:text', handlers.handlePlainMessage);
  bot.catch((err) => {
    const msg = err?.error?.message ?? err?.message ?? String(err);
    logger?.error(`telegram bot error: ${redact(msg)}`);
  });
}

// Minimal grammY-shaped stand-in used in mock mode. It records registered
// handlers so tests can assert the command surface, and never touches the
// network.
function createMockBot(handlers, logger) {
  const commands = new Map();
  const textHandlers = [];
  let errorHandler = null;
  let running = false;
  const bot = {
    __mock: true,
    commands,
    textHandlers,
    command(name, fn) { commands.set(name, fn); },
    on(event, fn) {
      if (event === 'message:text') textHandlers.push(fn);
    },
    catch(fn) { errorHandler = fn; },
    async start() {
      running = true;
      logger?.info('mock Telegram bot started (no Telegram calls will be made)');
    },
    async stop() {
      running = false;
      logger?.info('mock Telegram bot stopped');
    },
    isRunning() { return running; },
    // Test helper: feed a fake context through a registered command.
    async simulateCommand(name, ctx) {
      const fn = commands.get(name);
      if (!fn) throw new Error(`no such mock command: ${name}`);
      await fn(ctx);
    },
    async simulateText(ctx) {
      for (const fn of textHandlers) await fn(ctx);
    },
    __errorHandler: () => errorHandler,
  };
  registerBot(bot, handlers, logger);
  return bot;
}

export function createBot({ config, logger, tasks }) {
  const handlers = createHandlers({ config, logger, tasks });

  if (config.mockMode) {
    const bot = createMockBot(handlers, logger);
    let started = false;
    return {
      bot,
      handlers,
      async start() {
        if (started) return;
        started = true;
        logger?.info('starting Telegram bot in MOCK MODE (no real Telegram connection)');
        await bot.start();
      },
      async stop() {
        if (!started) return;
        started = false;
        await bot.stop();
        logger?.info('Telegram bot stopped');
      },
    };
  }

  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in live mode');
  }
  const bot = new Bot(config.telegramBotToken);
  registerBot(bot, handlers, logger);
  let started = false;
  return {
    bot,
    handlers,
    async start() {
      if (started) return;
      started = true;
      logger?.info('starting Telegram bot (live mode)');
      await bot.start();
    },
    async stop() {
      if (!started) return;
      started = false;
      await bot.stop();
      logger?.info('Telegram bot stopped');
    },
  };
}
