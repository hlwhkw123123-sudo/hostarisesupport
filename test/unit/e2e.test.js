// End-to-end test (Milestone 11).
// Simulates the full customer-issue workflow with mocks + a local
// node:http server only: no real Telegram, Gemini, or external network.
//   1. Customer message 'my website is down' arrives as a plain Telegram
//      message and is classified.
//   2. Diagnostics run against the local server.
//   3. A Bengali + English reply pair is generated from the diagnosis.
//   4. A status report task completes listing the work.
// Every stage must produce real output: nothing 'not-implemented', no
// invented findings (the only evidence is what the local server returned).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createHandlers } from '../../src/telegram/handlers.js';
import { TaskManager } from '../../src/tasks/manager.js';
import { createLogger } from '../../src/logger.js';
import { runDiagnostics } from '../../src/diagnostics/index.js';
import { generateReplies, validateReplyPair } from '../../src/replies/generator.js';

const OWNER_ID = 1; // fake owner in mock mode
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK_PROVIDER = {
  name: 'mock',
  generate: async () => { throw new Error('mock provider must not be called'); },
};

async function waitForTask(tasks, id, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = tasks.get(id);
    if (task && (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled')) return task;
    if (Date.now() > deadline) throw new Error(`timed out waiting for task ${id} (last status: ${task?.status ?? 'missing'})`);
    await sleep(100);
  }
}

test('e2e: customer "my website is down" -> classify -> diagnose local server -> reply pair -> status report', async (t) => {
  // Local stand-in for the customer's website: serves one real 200 page.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', server: 'HostariseE2E/1.0' });
    res.end('<html><body><h1>Example Site Home</h1></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const siteUrl = `http://127.0.0.1:${port}/`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); });

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostarise-e2e-'));
  const tasks = new TaskManager({ dataDir: dir, logger: createLogger({ level: 'error' }) });
  t.after(async () => { await tasks.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await tasks.load();

  const config = {
    mockMode: true,
    telegramBotToken: '',
    geminiApiKey: '',
    ownerTelegramId: null,
    teamTelegramIds: [],
  };
  const handlers = createHandlers({ config, logger: createLogger({ level: 'error' }), tasks });

  // --- Stage 1: plain Telegram message arrives and is classified. ---
  const replies = [];
  const ctx = {
    from: { id: OWNER_ID },
    message: { text: 'my website is down' },
    reply: async (msg) => { replies.push(String(msg)); },
  };
  await handlers.handlePlainMessage(ctx);
  assert.equal(replies.length, 1, 'bot must acknowledge the message once');
  const taskIdMatch = replies[0].match(/Task ID: (\S+)/);
  assert.ok(taskIdMatch, `acknowledgement must carry a task id, got: ${replies[0]}`);
  const plainTaskId = taskIdMatch[1];
  const plainTask = tasks.get(plainTaskId);
  assert.ok(plainTask, 'the classified task must exist in the TaskManager');
  assert.equal(plainTask.type, 'plain-task');
  assert.equal(plainTask.payload.classification.kind, 'diagnose', 'message must classify as a diagnose task');
  assert.ok(plainTask.payload.classification.confidence > 0, 'classification must carry a real confidence');
  assert.ok(!JSON.stringify(plainTask).includes('not-implemented'), 'no not-implemented marker at stage 1');

  // --- Stage 2: diagnostics run against the local server. ---
  // allowPrivate is required: the stand-in site is on loopback, and the
  // SSRF guard would otherwise (correctly) refuse it.
  const diagnosis = await runDiagnostics('127.0.0.1', {
    checks: ['http'],
    url: siteUrl,
    allowPrivate: true,
  });
  assert.equal(diagnosis.domain, '127.0.0.1');
  assert.equal(diagnosis.checks.length, 1);
  const httpCheck = diagnosis.checks[0];
  assert.equal(httpCheck.name, 'http');
  assert.equal(httpCheck.status, 'ok', `local server must answer 200, evidence: ${httpCheck.evidence.join(' | ')}`);
  assert.equal(httpCheck.details.statusCode, 200, 'status code must be the real observed 200');
  assert.equal(httpCheck.details.finalUrl, siteUrl);
  assert.ok(httpCheck.details.timingMs !== null && httpCheck.details.timingMs >= 0, 'real timing must be recorded');
  assert.ok(httpCheck.evidence.some((e) => /HTTP status: 200/.test(e)), 'evidence must cite the observed 200');
  assert.ok(!JSON.stringify(diagnosis).includes('not-implemented'), 'no not-implemented marker at stage 2');
  assert.equal(diagnosis.summary.ok, 1);
  assert.equal(diagnosis.summary.fail, 0);

  // --- Stage 3: reply pair generated from the real diagnosis. ---
  const diagnosisSummary = `HTTP check against the customer's site returned status ${httpCheck.details.statusCode} `
    + `in ${httpCheck.details.timingMs} ms (final URL ${httpCheck.details.finalUrl}).`;
  const pair = await generateReplies({
    customerMessage: 'my website is down',
    diagnosis: { summary: diagnosisSummary, category: 'website' },
    kb: 'Website down: first check the domain DNS and the hosting server status page.',
    provider: MOCK_PROVIDER,
  });
  assert.ok(pair.bengali && pair.bengali.trim().length > 20, 'Bengali reply must be real text');
  assert.ok(pair.english && pair.english.trim().length > 20, 'English reply must be real text');
  assert.notEqual(pair.bengali, pair.english);
  // The internal diagnosis stays internal: the raw numbers are context for
  // the team, not copy for the customer.
  assert.ok(!pair.english.includes('127.0.0.1'), 'internal loopback address must not leak into the customer reply');
  assert.equal(pair.diagnosis.summary, diagnosisSummary, 'diagnosis must be returned separately');
  const check = validateReplyPair({ bengali: pair.bengali, english: pair.english });
  assert.equal(check.ok, true, check.issues.join('; '));
  assert.ok(!/password/i.test(pair.english) || /never ask you for your password/i.test(pair.english),
    'English reply must not ask the customer for a password');

  // --- Stage 4: status report task completes listing the work. ---
  const reportReplies = [];
  const reportCtx = {
    from: { id: OWNER_ID },
    message: { text: '/report' },
    reply: async (msg) => { reportReplies.push(String(msg)); },
  };
  await handlers.report(reportCtx);
  const reportIdMatch = reportReplies[0].match(/Task ID: (\S+)/);
  assert.ok(reportIdMatch, `report acknowledgement must carry a task id, got: ${reportReplies[0]}`);
  const reportTask = await waitForTask(tasks, reportIdMatch[1]);
  assert.equal(reportTask.status, 'done', `report task must complete, result: ${JSON.stringify(reportTask.result)}`);
  assert.equal(reportTask.result.status, 'done');
  assert.ok(reportTask.result.summary && typeof reportTask.result.summary === 'object', 'report must carry status counts');
  assert.ok(Array.isArray(reportTask.result.recent), 'report must list recent tasks');
  const listedIds = reportTask.result.recent.map((x) => x.id);
  assert.ok(listedIds.includes(plainTaskId), 'report must list the stage-1 plain-message task');
  assert.ok(listedIds.includes(reportTask.id), 'report must list itself');
  const listedPlain = reportTask.result.recent.find((x) => x.id === plainTaskId);
  assert.ok(listedPlain.title.includes('my website is down'), 'report must show the customer issue title');
  assert.ok(!JSON.stringify(reportTask.result).includes('not-implemented'), 'no not-implemented marker at stage 4');
});
