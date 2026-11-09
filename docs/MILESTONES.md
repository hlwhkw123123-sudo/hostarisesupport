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
