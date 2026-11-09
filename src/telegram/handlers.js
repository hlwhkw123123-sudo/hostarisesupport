// Telegram command handlers (Milestone 3).
//
// Every handler is a plain async function taking a grammY-like context
// object ({ reply, from, message, match, ... }) so it can be unit-tested
// with fake contexts — no network, no real Telegram.
//
// Access control (see src/security.js getRole / PRIVILEGED_COMMANDS):
//   owner — everything.
//   team  — safe commands only: /start /help /status /tasks /knowledge /reply.
//   none  — polite refusal for every command, including /start.
// In mock mode the fake owner id 1 is treated as owner, so tests can run
// without real credentials.
//
// Long-running commands enqueue a TaskManager task and reply with the task
// id; the work itself runs in the background and never blocks the bot.
// Task handlers below call the real engines (diagnostics M7, AI reasoning
// M4, KB M5, replies M8, browser M6). Engines are loaded lazily with
// dynamic import: if one is missing or unavailable the task reports
// "not-implemented" honestly instead of inventing a finding. NEVER invent
// diagnostic findings; unknown = unknown.
//
// Errors: every handler is wrapped so a failure logs a redacted error and
// replies with a short human message. Stack traces and secrets never go
// to Telegram.
import { fileURLToPath } from 'node:url';
import { getRole, PRIVILEGED_COMMANDS, checkUrlSafe, checkPromptInjection } from '../security.js';
import { redact } from '../logger.js';

export const COMMANDS = [
  'start', 'help', 'status', 'diagnose', 'browse', 'test',
  'screenshot', 'reply', 'knowledge', 'tasks', 'cancel', 'report',
];

// Commands team members may run. Everything else is owner-only.
// (PRIVILEGED_COMMANDS from security.js — diagnose/browse/screenshot/test
// — is a subset of the owner-only set; /report and /cancel are also
// owner-only because they can expose or stop privileged work.)
export const SAFE_COMMANDS = new Set(['start', 'help', 'status', 'tasks', 'knowledge', 'reply']);
export const OWNER_ONLY_COMMANDS = new Set(
  COMMANDS.filter((c) => !SAFE_COMMANDS.has(c)),
);

const REFUSAL = 'Sorry, this bot is only for the Hostarise support team. '
  + 'If you need hosting help, please contact Hostarise support through the usual channel.';
const OWNER_ONLY_MSG = 'Sorry, that command is only available to the bot owner.';
const GENERIC_ERROR_MSG = 'Sorry, something went wrong while handling that. Please try again in a moment.';

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

// In mock mode the fake owner id 1 stands in for the real owner, so the
// whole command surface can be exercised without credentials.
export function getRoleFor(userId, config) {
  if (config?.mockMode && userId === 1) return 'owner';
  return getRole(userId, config ?? { ownerTelegramId: null, teamTelegramIds: [] });
}

function roleMayRun(role, command) {
  if (role === 'owner') return true;
  if (role === 'team') return SAFE_COMMANDS.has(command);
  return false;
}

// ---------------------------------------------------------------------------
// AI/reasoning integration point (Milestone 4 — WIRED)
// ---------------------------------------------------------------------------
// src/ai/reasoning.js exports `classifyTask(text)` returning
//   { category, kind, confidence: 0..1 }
// where kind is the category (unknown maps to 'general'). classifyMessage()
// below uses the real classifier and falls back to the keyword stub only if
// the module fails to load or returns an unexpected shape.
// ---------------------------------------------------------------------------

let reasoningModulePromise = null;
function loadReasoningModule() {
  if (!reasoningModulePromise) {
    // Resolves to null while src/ai/reasoning.js does not exist yet.
    reasoningModulePromise = import('../ai/reasoning.js').catch(() => null);
  }
  return reasoningModulePromise;
}

// Keyword stub only — used until the real AI Reasoning Engine lands.
export function classifyLocal(text) {
  const t = (text || '').toLowerCase();
  if (/https?:\/\/\S+/.test(t)) return { kind: 'browse', confidence: 0, summary: 'stub: message contains a URL' };
  if (/\b(customer|client|whatsapp|reply to|draft a reply)\b/.test(t)) {
    return { kind: 'reply', confidence: 0, summary: 'stub: looks like a customer-message reply request' };
  }
  if (/\b(down|dns|ssl|domain|website|site|error|not loading|email)\b/.test(t)) {
    return { kind: 'diagnose', confidence: 0, summary: 'stub: looks like a technical issue' };
  }
  return { kind: 'general', confidence: 0, summary: 'stub: unclassified request' };
}

export async function classifyMessage(text, logger) {
  try {
    const mod = await loadReasoningModule();
    if (mod && typeof mod.classifyTask === 'function') {
      const result = await mod.classifyTask(text);
      if (result && typeof result.kind === 'string') return result;
      logger?.warn('AI classifyTask returned an unexpected shape; using local stub');
    }
  } catch (err) {
    logger?.error(`AI classification failed, using local stub: ${redact(err.message)}`);
  }
  return classifyLocal(text);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(ctx) {
  // grammY sets ctx.match to the text after the command; fall back to
  // parsing ctx.message.text (also handles "/cmd@BotName args").
  if (typeof ctx.match === 'string' && ctx.match.trim()) return ctx.match.trim();
  const text = ctx.message?.text ?? '';
  const withoutCommand = text.replace(/^\/\S+(@\S+)?\s*/, '');
  return withoutCommand.trim();
}

async function safeReply(ctx, text, logger) {
  try {
    await ctx.reply(text);
  } catch (err) {
    logger?.error(`failed to reply on Telegram: ${redact(err.message)}`);
  }
}

// ---------------------------------------------------------------------------
// Real task handlers — call the engines built in Milestones 4–8.
// Engines load lazily (dynamic import); a missing/unavailable engine
// reports "not-implemented" honestly instead of inventing a finding.
// ---------------------------------------------------------------------------
const KB_DIR = fileURLToPath(new URL('../../knowledge', import.meta.url));

async function loadModule(relativePath, logger, what) {
  try {
    return await import(relativePath);
  } catch (err) {
    logger?.warn(`${what} module not available: ${redact(err.message)}`);
    return null;
  }
}

function extractDomain(target) {
  let t = (target || '').trim();
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].split(':')[0].split('?')[0].split('#')[0];
  return t;
}

function notImplemented(what) {
  return { status: 'not-implemented', note: `${what} engine is not available right now. No finding was made.` };
}

async function loadBrowserEngine(config, logger) {
  if (config?.browserEnabled === false) return null;
  const mod = await loadModule('../browser/engine.js', logger, 'Browser');
  if (!mod?.createBrowserEngine) return null;
  const engine = mod.createBrowserEngine({ config, logger });
  try {
    if (!(await engine.isAvailable())) return null;
  } catch {
    return null;
  }
  return engine;
}

function sessionIdOf(session) {
  if (!session) return null;
  return typeof session === 'string' ? session : (session.id ?? session.sessionId ?? null);
}

// Register the real task handlers for every task type the commands below
// enqueue, once per TaskManager instance.
const registeredManagers = new WeakSet();
function registerTaskHandlers(tasks, logger, config) {
  if (!tasks || registeredManagers.has(tasks)) return;
  registeredManagers.add(tasks);
  const handlers = {
    diagnose: async (task, onProgress) => {
      const domain = extractDomain(task.payload?.target);
      if (!domain) return { status: 'unknown', note: 'no domain given' };
      const mod = await loadModule('../diagnostics/index.js', logger, 'Diagnostics');
      if (!mod?.runDiagnostics) return notImplemented('Diagnostics');
      await onProgress(10, `running diagnostics for ${domain}`);
      const result = await mod.runDiagnostics(domain);
      await onProgress(100, 'diagnostics complete');
      return { status: 'done', ...result };
    },
    test: async (task, onProgress) => {
      const domain = extractDomain(task.payload?.target);
      if (!domain) return { status: 'unknown', note: 'no target given' };
      const mod = await loadModule('../diagnostics/index.js', logger, 'Diagnostics');
      if (!mod?.runDiagnostics) return notImplemented('Diagnostics');
      await onProgress(20, `testing connectivity for ${domain}`);
      const result = await mod.runDiagnostics(domain, { checks: ['http', 'dns'] });
      return { status: 'done', ...result };
    },
    'reply-draft': async (task, onProgress) => {
      const mod = await loadModule('../replies/generator.js', logger, 'Replies');
      if (!mod?.generateReplies) return notImplemented('Customer replies');
      const kbMod = await loadModule('../kb/index.js', logger, 'Knowledge base');
      const aiMod = await loadModule('../ai/provider.js', logger, 'AI provider');
      const kb = kbMod?.loadKnowledgeBase ? await kbMod.loadKnowledgeBase(KB_DIR) : null;
      const provider = aiMod?.createAiProvider ? aiMod.createAiProvider(config, logger) : null;
      await onProgress(30, 'drafting customer reply');
      const pair = await mod.generateReplies({
        customerMessage: task.payload?.customerMessage ?? '',
        diagnosis: '',
        kb, provider,
      });
      return { status: 'done', ...pair };
    },
    'plain-task': async (task, onProgress, log) => {
      const reasoningMod = await loadModule('../ai/reasoning.js', logger, 'AI reasoning');
      if (!reasoningMod?.runReasoning) return notImplemented('AI reasoning');
      const kbMod = await loadModule('../kb/index.js', logger, 'Knowledge base');
      const aiMod = await loadModule('../ai/provider.js', logger, 'AI provider');
      const diagMod = await loadModule('../diagnostics/index.js', logger, 'Diagnostics');
      const kb = kbMod?.loadKnowledgeBase ? await kbMod.loadKnowledgeBase(KB_DIR) : null;
      const provider = aiMod?.createAiProvider ? aiMod.createAiProvider(config, logger) : null;
      const tools = {
        diagnostics: async ({ domain }) => (diagMod?.runDiagnostics ? diagMod.runDiagnostics(domain) : { error: 'diagnostics unavailable' }),
        kbSearch: async ({ query }) => (kb ? kb.search(query, { limit: 3 }) : []),
      };
      const text = task.payload?.text ?? '';
      // runReasoning expects a logger-shaped `log` ({ info, warn, ... });
      // TaskManager passes a plain log(line) function, so adapt it here.
      const taskLog = {
        info: (m, meta) => log(meta ? `${m} ${JSON.stringify(meta)}` : String(m)),
        warn: (m, meta) => log(meta ? `${m} ${JSON.stringify(meta)}` : String(m)),
        error: (m, meta) => log(meta ? `${m} ${JSON.stringify(meta)}` : String(m)),
        debug: () => {},
      };
      return reasoningMod.runReasoning({ provider, kb, tools, task: text, onProgress, log: taskLog });
    },
    report: async () => {
      const list = tasks.list({ limit: 50 });
      const counts = {};
      for (const t of list) counts[t.status] = (counts[t.status] ?? 0) + 1;
      return {
        status: 'done',
        summary: counts,
        recent: list.slice(0, 10).map((t) => ({ id: t.id, title: t.title, status: t.status })),
      };
    },
    browse: async (task, onProgress) => {
      const engine = await loadBrowserEngine(config, logger);
      if (!engine) return notImplemented('Browser');
      let sid = null;
      try {
        const session = await engine.open(task.payload?.url);
        sid = sessionIdOf(session);
        await onProgress(50, 'page opened, reading content');
        const text = await engine.getText(sid, 'body');
        return { status: 'done', url: task.payload?.url, text: String(text ?? '').slice(0, 2000) };
      } finally {
        // Always shut the browser down when no sessions remain — even when
        // open() itself threw after launching it — otherwise the Chromium
        // child process keeps the Node event loop alive forever.
        if (sid) await engine.close(sid).catch(() => {});
        if (engine.sessionCount() === 0) await engine.closeAll().catch(() => {});
      }
    },
    screenshot: async (task, onProgress) => {
      const engine = await loadBrowserEngine(config, logger);
      if (!engine) return notImplemented('Browser');
      let sid = null;
      try {
        const session = await engine.open(task.payload?.url);
        sid = sessionIdOf(session);
        await onProgress(60, 'page opened, capturing screenshot');
        const png = await engine.screenshot(sid);
        return { status: 'done', url: task.payload?.url, screenshotBytes: png?.length ?? 0 };
      } finally {
        if (sid) await engine.close(sid).catch(() => {});
        if (engine.sessionCount() === 0) await engine.closeAll().catch(() => {});
      }
    },
  };
  for (const [type, fn] of Object.entries(handlers)) tasks.registerHandler(type, fn);
  logger?.debug('telegram real task handlers registered');
}

// Enqueue a long task and reply with its id. Returns the task (or null).
async function enqueueAndAcknowledge(ctx, deps, { type, title, payload }) {
  const task = await deps.tasks.enqueue({
    type, title, payload, createdBy: ctx.from?.id ?? null,
  });
  await safeReply(
    ctx,
    `Started: ${title}\nTask ID: ${task.id}\nI'll send the result here when it's done. Use /tasks to check progress or /cancel ${task.id} to stop it.`,
    deps.logger,
  );
  return task;
}

// Wrap a command handler with role gating + error handling.
function wrap(command, deps, fn) {
  return async (ctx) => {
    const userId = ctx.from?.id;
    const role = getRoleFor(userId, deps.config);
    if (role === 'none') {
      deps.logger?.warn(`refused ${command} from unauthorized user ${userId}`);
      await safeReply(ctx, REFUSAL, deps.logger);
      return;
    }
    if (!roleMayRun(role, command)) {
      deps.logger?.warn(`refused ${command} from ${role} user ${userId}`);
      await safeReply(ctx, OWNER_ONLY_MSG, deps.logger);
      return;
    }
    try {
      await fn(ctx);
    } catch (err) {
      deps.logger?.error(`handler /${command} failed: ${redact(err.message)}`);
      await safeReply(ctx, GENERIC_ERROR_MSG, deps.logger);
    }
  };
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export function createHandlers({ config, logger, tasks }) {
  registerTaskHandlers(tasks, logger, config);
  const deps = { config, logger, tasks };

  const handlers = {
    start: wrap('start', deps, async (ctx) => {
      await safeReply(ctx,
        'Hello, this is the Hostarise support bot.\n\n'
        + 'I can run diagnostics, browse the hosting panel, draft customer replies, and track background tasks.\n'
        + 'Send /help to see the commands you can use.',
        logger);
    }),

    help: wrap('help', deps, async (ctx) => {
      const role = getRoleFor(ctx.from?.id, config);
      const lines = [
        'Hostarise support bot — commands:',
        '/start — say hello and check the bot is up',
        '/help — this list',
        '/status — bot and task status',
        '/tasks — list recent tasks',
        '/knowledge <question> — look up the knowledge base',
        '/reply <customer message> — draft a customer reply (Bengali + English)',
      ];
      if (role === 'owner') {
        lines.push(
          '/diagnose <domain or issue> — run technical diagnostics (owner only)',
          '/browse <url> — open a page in the browser engine (owner only)',
          '/screenshot <url> — take a page screenshot (owner only)',
          '/test <target> — run a connectivity test (owner only)',
          '/report — build a status report (owner only)',
          '/cancel <task id> — cancel a running task (owner only)',
        );
      }
      lines.push('\nYou can also just send me a message describing the issue, and I will treat it as a task.');
      await safeReply(ctx, lines.join('\n'), logger);
    }),

    status: wrap('status', deps, async (ctx) => {
      const all = tasks ? tasks.list({ limit: 100 }) : [];
      const counts = {};
      for (const t of all) counts[t.status] = (counts[t.status] ?? 0) + 1;
      const summary = Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(', ') || 'no tasks yet';
      await safeReply(ctx,
        'Hostarise support bot is running.\n'
        + `Mode: ${config.mockMode ? 'mock (no real Telegram/Gemini calls)' : 'live'}\n`
        + `Uptime: ${Math.round(process.uptime())}s\n`
        + `Tasks — ${summary}`,
        logger);
    }),

    diagnose: wrap('diagnose', deps, async (ctx) => {
      const target = parseArgs(ctx);
      if (!target) {
        await safeReply(ctx, 'Usage: /diagnose <domain or issue>\nExample: /diagnose example.com', logger);
        return;
      }
      const injection = checkPromptInjection(target);
      if (injection.flagged) {
        logger?.warn(`prompt-injection pattern in /diagnose input from ${ctx.from?.id}`);
        await safeReply(ctx, 'I can only diagnose a domain or a plain description of the issue. Please rephrase without instructions.', logger);
        return;
      }
      await enqueueAndAcknowledge(ctx, deps, {
        type: 'diagnose', title: `Diagnose: ${target}`, payload: { target },
      });
    }),

    browse: wrap('browse', deps, async (ctx) => {
      const url = parseArgs(ctx).split(/\s+/)[0] || '';
      if (!url) {
        await safeReply(ctx, 'Usage: /browse <url>\nExample: /browse https://example.com', logger);
        return;
      }
      const check = await checkUrlSafe(url);
      if (!check.ok) {
        await safeReply(ctx, `I can't open that URL: ${check.reason}.`, logger);
        return;
      }
      await enqueueAndAcknowledge(ctx, deps, {
        type: 'browse', title: `Browse: ${url}`, payload: { url },
      });
    }),

    screenshot: wrap('screenshot', deps, async (ctx) => {
      const url = parseArgs(ctx).split(/\s+/)[0] || '';
      if (!url) {
        await safeReply(ctx, 'Usage: /screenshot <url>\nExample: /screenshot https://example.com', logger);
        return;
      }
      const check = await checkUrlSafe(url);
      if (!check.ok) {
        await safeReply(ctx, `I can't screenshot that URL: ${check.reason}.`, logger);
        return;
      }
      await enqueueAndAcknowledge(ctx, deps, {
        type: 'screenshot', title: `Screenshot: ${url}`, payload: { url },
      });
    }),

    test: wrap('test', deps, async (ctx) => {
      const target = parseArgs(ctx);
      if (!target) {
        await safeReply(ctx, 'Usage: /test <domain or URL>\nExample: /test example.com', logger);
        return;
      }
      await enqueueAndAcknowledge(ctx, deps, {
        type: 'test', title: `Test: ${target}`, payload: { target },
      });
    }),

    reply: wrap('reply', deps, async (ctx) => {
      const text = parseArgs(ctx);
      if (!text) {
        await safeReply(ctx, 'Usage: /reply <customer message>\nPaste the customer message after the command and I will draft a reply.', logger);
        return;
      }
      const injection = checkPromptInjection(text);
      if (injection.flagged) {
        logger?.warn(`prompt-injection pattern in /reply input from ${ctx.from?.id}`);
        await safeReply(ctx, 'That message looks like it contains instructions for me rather than a customer message. Please paste only the customer message itself.', logger);
        return;
      }
      await enqueueAndAcknowledge(ctx, deps, {
        type: 'reply-draft', title: 'Draft customer reply', payload: { customerMessage: text },
      });
    }),

    knowledge: wrap('knowledge', deps, async (ctx) => {
      const query = parseArgs(ctx);
      if (!query) {
        await safeReply(ctx, 'Usage: /knowledge <question>\nExample: /knowledge What are the hosting plans?', logger);
        return;
      }
      const kbMod = await loadModule('../kb/index.js', logger, 'Knowledge base');
      if (!kbMod?.loadKnowledgeBase) {
        await safeReply(ctx, 'The knowledge base is not connected yet, so I cannot look anything up right now.', logger);
        return;
      }
      const kb = await kbMod.loadKnowledgeBase(KB_DIR);
      const results = kb.search(query, { limit: 3 });
      if (results.length === 0) {
        await safeReply(ctx, `I found nothing in the knowledge base for "${query}".`, logger);
        return;
      }
      const lines = [`Knowledge base — top matches for "${query}":`];
      for (const r of results) {
        lines.push(`• ${r.title} (${r.verified ? 'verified' : 'unverified note'}): ${r.snippet}`);
      }
      await safeReply(ctx, lines.join('\n'), logger);
    }),

    tasks: wrap('tasks', deps, async (ctx) => {
      const list = tasks ? tasks.list({ limit: 10 }) : [];
      if (list.length === 0) {
        await safeReply(ctx, 'No tasks yet. Long commands like /diagnose create tasks that show up here.', logger);
        return;
      }
      const lines = ['Recent tasks:'];
      for (const t of list) {
        lines.push(`• ${t.id} — ${t.title} [${t.status}] ${t.progress ?? 0}%`);
      }
      await safeReply(ctx, lines.join('\n'), logger);
    }),

    cancel: wrap('cancel', deps, async (ctx) => {
      const id = parseArgs(ctx).split(/\s+/)[0] || '';
      if (!id) {
        await safeReply(ctx, 'Usage: /cancel <task id>\nExample: /cancel task-abc123', logger);
        return;
      }
      const result = await tasks.cancel(id);
      if (!result.ok) {
        await safeReply(ctx, `Couldn't cancel that task: ${result.reason}.`, logger);
        return;
      }
      await safeReply(ctx, `Cancelled task ${id} (${result.task.title}).`, logger);
    }),

    report: wrap('report', deps, async (ctx) => {
      await enqueueAndAcknowledge(ctx, deps, {
        type: 'report', title: 'Status report', payload: {},
      });
    }),

    // Plain (non-command) text: classify and enqueue as a task request.
    // NOTE: this handler is NOT wrapped by wrap() (it has no command name
    // for roleMayRun), so it does its own role + error handling.
    handlePlainMessage: async (ctx) => {
      const userId = ctx.from?.id;
      const role = getRoleFor(userId, config);
      if (role === 'none') {
        logger?.warn(`refused plain message from unauthorized user ${userId}`);
        await safeReply(ctx, REFUSAL, logger);
        return;
      }
      try {
        const text = ctx.message?.text ?? '';
        if (!text.trim()) return;
        const injection = checkPromptInjection(text);
        if (injection.flagged) {
          logger?.warn(`prompt-injection pattern in plain message from ${userId}`);
          await safeReply(ctx,
            'That message looks like instructions for me rather than a support request. '
            + 'Please describe the issue in your own words and I will treat it as a task.',
            logger);
          return;
        }
        const classification = await classifyMessage(text, logger);
        await enqueueAndAcknowledge(ctx, deps, {
          type: 'plain-task',
          title: `Request (${classification.kind}): ${text.slice(0, 80)}`,
          payload: { text, classification },
        });
      } catch (err) {
        logger?.error(`plain-message handler failed: ${redact(err.message)}`);
        await safeReply(ctx, GENERIC_ERROR_MSG, logger);
      }
    },
  };

  return handlers;
}

// Re-exported for callers that gate on the privileged set directly.
export { PRIVILEGED_COMMANDS };
