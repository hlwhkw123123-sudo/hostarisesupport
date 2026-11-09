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
- Status: IN PROGRESS
- Contents: package.json (grammy, @google/generative-ai, dotenv, playwright),
  .env.example, .gitignore, src/config.js (env validation, mock/live modes),
  src/logger.js (secret-redacting logger), src/security.js (SSRF guard,
  prompt-injection guard, path guard, roles), src/tasks/manager.js
  (persistent JSON task queue, background run, cancel, retry),
  src/index.js (entry + graceful shutdown), README.md.
- Tests: (to be recorded)

## Milestone 8 — Customer Communication Engine
- Status: DONE (2026-11-09).
- Contents: `src/replies/generator.js` — `generateReplies({ customerMessage, diagnosis, kb, provider, language })` returning `{ bengali, english, diagnosis, warnings }` and `validateReplyPair({ bengali, english })`. Exactly one Bengali + one English reply; diagnosis kept separate; password/secret requests and guarantee wording stripped from output; no invented policies/prices/actions (KB gap => reply says the team will check and follow up); prompt-injected customer text flagged in `warnings` and treated as data only. AI path uses the documented `generate({ prompt, system, tools })` interface; mock/missing provider falls back to template replies from diagnosis + KB snippets, labelled in `warnings`. `src/ai/provider.js` and `src/kb/index.js` do not exist yet, so they are dynamic-imported defensively with a "module not ready" fallback.
- Tests: `test/unit/replies-ops.test.js` — 11 tests, 11 pass, 0 fail (`node --test test/unit/replies-ops.test.js`).

## Milestone 9 — Hosting Operations Engine
- Status: DONE (2026-11-09).
- Contents: `src/ops/hosting.js` — `createOpsEngine({ browser, tasks, logger, config })` returning `{ requestApproval, approve, execute, listApprovals, getApproval }`. Op types: createEmail, changeEmailPassword, setEmailQuota (alias setQuota), createSubdomain, addAddonDomain, inspectDns, inspectSsl, runBackup. inspectDns/inspectSsl run immediately; all mutating/security-sensitive ops require an approved approval record for that op id or `execute()` refuses. Approvals stored in memory + persisted to `DATA_DIR/approvals.json`. Execution delegates to the injected browser (`execute`/`runOp`/`performOperation`/`run`); with no browser it returns `{ ok: false, reason: 'browser unavailable — operation not performed' }` and never pretends it ran. Passwords accepted only as function arguments, stripped from approval records, task payloads and logs (verified by test).
- Tests: same file as Milestone 8 — 11 tests, 11 pass, 0 fail.

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
  - Milestone 2's entry above still reads "IN PROGRESS / (to be
    recorded)" although its work is committed; that is a docs-only gap,
    not a code gap.
