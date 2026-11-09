# Milestone log — Hostarise AI Agent

Recorded after each milestone: what was built, what tests actually ran,
and the result. A test is only marked passed if it was executed.

## Milestone 1 — Repository Audit
- Status: NOT APPLICABLE.
- Evidence: `git ls-remote` on `hlwhkw123123-sudo/hostarisesupport` returned
  no refs; clone warned "empty repository". No source files, no knowledge-base
  documents exist to audit or preserve. Recorded 2026-11-09.
- Decision: fresh build starting at Milestone 2.

## Milestone 2 — Core Project Structure
- Status: DONE (2026-11-09). Commit `41827f1`.
- Contents: package.json (grammy, @google/generative-ai, dotenv, playwright),
  .env.example, .gitignore, src/config.js (env validation, mock/live modes),
  src/logger.js (secret-redacting logger), src/security.js (SSRF guard,
  prompt-injection guard, path guard, roles), src/tasks/manager.js
  (persistent JSON task queue, background run, cancel, retry),
  src/index.js (entry + graceful shutdown), README.md.
- Tests: core modules exercised by the Telegram suite (17 tests, incl.
  task flows) and the security suite (9 tests); `npm run check` OK.
  (Entry corrected 2026-11-09: it previously read "IN PROGRESS".)

## Milestone 3 — Telegram Control System
- Status: DONE (2026-11-09). Commit `b9c11cd` (with M4+M5).
- Contents: `src/telegram/bot.js` (grammY live bot + mock stand-in with
  the same command surface, no network in mock mode),
  `src/telegram/handlers.js` — all 13 commands from SPEC §3A:
  /start /help /status /diagnose /browse /test /screenshot /reply
  /knowledge /tasks /cancel /report, plus plain-text handling,
  progress notifications, background tasks, cancellation, error
  reporting (redacted), conversation context, task history.
  Role gating: strangers refused on privileged commands; team members
  limited to safe commands.
- Tests: `test/unit/telegram.test.js` — 17 tests, 17 pass, 0 fail.

## Milestone 4 — AI Reasoning Engine
- Status: DONE (2026-11-09). Commit `b9c11cd` (with M3+M5).
- Contents: `src/ai/provider.js` (Gemini provider + mock provider,
  `generate({ prompt, system, tools })` interface), `src/ai/reasoning.js`
  (classify → plan → tool loop → evaluate → report; returns
  `{ category, kind, confidence }`, unknown → kind 'general').
  Prompt-injected input is treated as data, never as instructions.
  Retries, timeouts, graceful failure; never invents findings.
- Tests: `test/unit/ai.test.js` — 13 tests, 13 pass, 0 fail.

## Milestone 5 — Knowledge Base Integration
- Status: DONE (2026-11-09). Commit `b9c11cd` (with M3+M4).
- Contents: `src/kb/index.js` (Markdown discovery/search over
  `knowledge/`), seed docs `knowledge/hostarise-background.md`,
  `knowledge/support-playbook.md`, `knowledge/customer-reply-rules.md`
  (132 lines total). Seed facts are the 2026-11-01 Hostarise notes,
  marked dated/unverified; ownership NOT confirmed; nothing invented.
- Tests: `test/unit/kb.test.js` — 7 tests, 7 pass, 0 fail.

## Milestone 6 — Browser Automation Engine
- Status: DONE (2026-11-09). Commit `c91bbe3`.
- Contents: `src/browser/engine.js` (lazy Playwright import — the app
  runs without a browser; `isAvailable()` probe; isolated context per
  session; SSRF-safe URLs; CAPTCHA detection that stops, never
  bypasses; 30 s navigation / 10 s action timeouts; screenshots),
  `src/browser/cpanel.js` (resilient field lookup, login flow with
  evidence; passwords never logged or returned).
  Termux limit documented honestly in the engine header: Playwright
  on Termux/Android is experimental and unverified here.
- Tests: `test/unit/browser.test.js` — 11 tests, 11 pass, 0 fail,
  against a real Chromium (Playwright chromium v1254, installed
  during this milestone) and a local `node:http` test site only.
  Two test-found bugs fixed: missing `turnstile` CAPTCHA marker,
  missing `await` on `context.newPage()`.

## Milestone 7 — Technical Diagnostics
- Status: DONE (2026-11-09). Commit `cd1f616`.
- Contents: `src/diagnostics/` — `index.js` (orchestrator),
  `dns.js`, `ssl.js`, `http.js`, `email.js` (SMTP + SPF/DKIM/DMARC),
  `wordpress.js`, `resources.js` (PHP/MySQL/cPanel/WHM/server
  resources, page-load and application errors). No browser needed.
  Never claims log/DB/account inspection without real access.
- Tests: `test/unit/diagnostics.test.js` — 21 tests, 21 pass, 0 fail.

## Milestone 8 — Customer Communication Engine
- Status: DONE (2026-11-09).
- Contents: `src/replies/generator.js` — `generateReplies({ customerMessage, diagnosis, kb, provider, language })` returning `{ bengali, english, diagnosis, warnings }` and `validateReplyPair({ bengali, english })`. Exactly one Bengali + one English reply; diagnosis kept separate; password/secret requests and guarantee wording stripped from output; no invented policies/prices/actions (KB gap => reply says the team will check and follow up); prompt-injected customer text flagged in `warnings` and treated as data only. AI path uses the documented `generate({ prompt, system, tools })` interface; mock/missing provider falls back to template replies from diagnosis + KB snippets, labelled in `warnings`. `src/ai/provider.js` and `src/kb/index.js` do not exist yet, so they are dynamic-imported defensively with a "module not ready" fallback.
- Tests: `test/unit/replies-ops.test.js` — 11 tests, 11 pass, 0 fail (`node --test test/unit/replies-ops.test.js`).

## Milestone 9 — Hosting Operations Engine
- Status: DONE (2026-11-09).
- Contents: `src/ops/hosting.js` — `createOpsEngine({ browser, tasks, logger, config })` returning `{ requestApproval, approve, execute, listApprovals, getApproval }`. Op types: createEmail, changeEmailPassword, setEmailQuota (alias setQuota), createSubdomain, addAddonDomain, inspectDns, inspectSsl, runBackup. inspectDns/inspectSsl run immediately; all mutating/security-sensitive ops require an approved approval record for that op id or `execute()` refuses. Approvals stored in memory + persisted to `DATA_DIR/approvals.json`. Execution delegates to the injected browser (`execute`/`runOp`/`performOperation`/`run`); with no browser it returns `{ ok: false, reason: 'browser unavailable — operation not performed' }` and never pretends it ran. Passwords accepted only as function arguments, stripped from approval records, task payloads and logs (verified by test).
- Tests: same file as Milestone 8 — 11 tests, 11 pass, 0 fail.

## Milestone 10 — Task Management and Security
- Status: DONE (2026-11-09). No separate worker; delivered as the
  integration of Milestone 2 components, verified in Milestone 11.
- Contents: `src/tasks/manager.js` (persistent JSON queue in
  `DATA_DIR/tasks.json`, background execution, task IDs, progress
  tracking, cancellation, retry policies, execution logs, failure
  recovery; long tasks never block Telegram handling) and
  `src/security.js` (role-based authorization — owner / team /
  stranger; SSRF guard; prompt-injection guard; path guard; secure
  session cleanup; approval workflows for sensitive ops; redacted
  logs). Integration commit `f1b7c69` wired the real engines into the
  Telegram task handlers and fixed two real bugs found by the tests:
  (1) TaskManager concurrent `save()` race on the shared tmp file
  (ENOENT, flaky 1–2 failures/run) — saves serialized through a
  promise chain, `close()` drains the in-flight queue (also fixed an
  ENOTEMPTY race in teardown); suite went from flaky to 0 failures in
  20+ runs. (2) Browser sessions leaked the Chromium child process
  when `open()` threw after launching — `closeAll()` now runs in
  `finally`. Also fixed: `loadKnowledgeBase` must be awaited; the
  `log` adapter for `runReasoning` (logger-shaped, not a plain
  function); `/browse` test URL changed from `https://8.8.8.8/` (no
  web server; navigation hangs) to `https://example.com/`; `npm test`
  fixed to the glob form (`node --test "test/unit/*.test.js"` — the
  directory form fails on this Node version).
- Tests: task flows covered by `test/unit/telegram.test.js` (17 pass)
  and the end-to-end test; security covered by
  `test/unit/security.test.js` (9 pass, Milestone 11).

## Milestone 11 — Complete Testing and Bug Fixing
- Status: DONE (2026-11-09).
- Static checks: `npm run check` — `node --check` over every file in
  `src/*.js` and `src/*/*.js` — printed `OK`, exit 0. No syntax errors.
- Dependency audit: `npm audit` could NOT run in this environment. The
  sandbox npm registry policy blocks the audit endpoint:
  `403 Forbidden - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick
  - policy_denied` (`npm error audit endpoint returned an error`, exit 1).
  No severity counts could be obtained and no dependency fix was attempted.
  Known issue: re-run `npm audit` on a machine with normal registry access
  before handover; no audit data exists yet either way.
- Security tests: new `test/unit/security.test.js` — 9 tests, 9 pass, 0 fail
  (`node --test test/unit/security.test.js`):
  (a) a stranger (non-owner/non-team) is refused by every privileged
  handler (/diagnose, /browse, /screenshot, /test, /report, /cancel) and
  by safe commands and plain messages, with zero tasks created; a team
  member is refused all privileged commands but /status still works;
  (b) `logger.redact` removes a real-shaped Telegram bot token, a Gemini
  `AIza…` key, and a `password: …` value (plus `extraSecrets`) from a log
  line, leaving non-secret text intact; (c) `checkPromptInjection` flags
  5 injection phrasings (ignore/disregard instructions, reveal system
  prompt, new instructions, jailbreak) and does NOT flag a normal support
  message; (d) `checkUrlSafe` blocks localhost, 169.254.169.254,
  10.0.0.5, 192.168.1.1, 172.16.0.9, 127.0.0.1 and ftp://, and allows
  https://example.com (DNS resolved in this environment);
  (e) `safeJoin` blocks `../secret.txt`, `../../etc/passwd`, `/etc/passwd`
  and allows paths inside the base; (f) the ops engine refuses an
  unapproved (and a merely pending) `changeEmailPassword` op, never calls
  the browser, and the password never appears in `approvals.json`;
  (g) `generateReplies` never outputs a password request, neither via the
  template path when the customer asks for their password, nor via a
  hostile AI provider whose output asks for the cPanel password (stripped,
  safe replacement line added, pair still validates).
- End-to-end test: new `test/unit/e2e.test.js` — 1 test, 1 pass, 0 fail.
  Local `node:http` server only (no real Telegram/Gemini/network):
  (1) plain message 'my website is down' arrives via the real Telegram
  handler, classifies as `diagnose` with confidence > 0 and enqueues a
  real task; (2) `runDiagnostics` against the local server returns a real
  HTTP check: status `ok`, status code 200, real timing, evidence citing
  the observed 200; (3) a Bengali + English reply pair is generated from
  that diagnosis, validates clean, and leaks no internal address;
  (4) a `/report` task completes with status `done` and lists the stage-1
  task and itself. No stage produced 'not-implemented' or an invented
  finding.
- Full suite: `npm test` run 3 times, 90 tests each time (was 80 before
  this milestone: +9 security, +1 E2E). Run 1: 90 pass, 0 fail
  (~7.6 s). Run 2: 90 pass, 0 fail (~7.9 s). Run 3: 90 pass, 0 fail
  (~7.7 s). No flakiness observed across the three runs.
- Bugs found and fixed: none in `src/` — no implementation file was
  changed. One test-side mistake was found and fixed while writing the
  security suite: the first `safeJoin` test expected Windows-style
  `..\..\secret.txt` to be an escape, but on Linux a backslash is a
  literal filename character, so that path names a file inside the base
  directory and `safeJoin` is correct to allow it; the test was corrected
  (the case is documented in the test as a comment).
- Remaining known issues:
  - `npm audit` unavailable in this sandbox (registry policy blocks the
    audit endpoint); no dependency-vulnerability data yet.
  - The pre-existing browser test logs a Playwright navigation failure
    (`net::ERR_TUNNEL_CONNECTION_FAILED` at https://example.com) because
    this environment's proxy blocks that fetch; the test still passes
    because it asserts graceful failure handling, but live browser checks
    against public sites have not been verified from this machine.
  - Milestone 2's entry above has been corrected to DONE (2026-11-09,
    during Milestone 12); that docs-only gap is now closed.

## Milestone 12 — Termux Deployment Preparation
- Status: DONE (2026-11-09).
- Contents: `docs/TERMUX.md` (install, configure, start/stop, wake
  lock, Android interruptions, troubleshooting; browser-on-Termux
  limit stated honestly), `docs/SETUP.md` (env reference, how to get
  the Telegram token / Gemini key / owner ID, first live checks),
  `docs/VPS-MIGRATION.md` (VPS install, browser on VPS, systemd
  service, backups, health checks). README updated to point at the
  finished docs.
- Bug found and fixed during verification (real bug, `src/` change):
  in mock mode `npm start` exited ~0.14 s after starting because
  nothing held the event loop open (live mode is held open by grammY
  long polling). Fixed in `src/index.js` with a 60 s heartbeat
  interval in mock mode only. Verified: process stays alive under
  `timeout 5` (exit 124 = killed by timeout, not self-exit) and
  SIGTERM shuts it down gracefully (`Shutdown complete.`).
- Tests: full suite re-run after the fix — `npm run check` OK,
  `npm test` 90 pass, 0 fail. Termux steps themselves were NOT run
  on a real phone; the docs say so and the first phone run is a
  test run (see `docs/TERMUX.md`).

## Milestone 13 — Final Documentation and Handover
- Status: DONE (2026-11-09).
- Contents: `docs/HANDOVER.md` (architecture, final folder structure,
  implemented features, test results, bugs fixed, remaining
  limitations, known issues, what is needed from the owner next),
  `docs/MILESTONES.md` completed (M2 corrected to DONE; M3–M7, M10,
  M12, M13 entries added; all 13 milestones now recorded).
- Final acceptance check (SPEC §12): all modules implemented — yes;
  no known critical/high bugs — none known (see HANDOVER §6–§8 for
  the fixed bugs and the open limitations); all automated tests pass
  — 90/90, re-verified after the last fix; integration tests pass
  with mocked services — yes (e2e test); browser tests pass in a
  supported env — yes (real Chromium on Linux; Termux browser NOT
  verified, documented); security checks done — 9 security tests
  pass, `npm audit` still blocked in this sandbox (recorded);
  config documented — `docs/SETUP.md`; Termux limits documented —
  `docs/TERMUX.md` §5; startup/shutdown documented — `docs/SETUP.md`
  §5, `docs/TERMUX.md` §4; KB seeded honestly — dated, unverified
  notes only; owner can configure credentials alone — `docs/SETUP.md`
  §3. Not claimed bug-free or fully tested everywhere — see
  `docs/HANDOVER.md` §7.
- Handover contents (SPEC §13): delivered in `docs/HANDOVER.md`.
  Nothing pushed to GitHub; no Telegram/Gemini keys requested yet.
