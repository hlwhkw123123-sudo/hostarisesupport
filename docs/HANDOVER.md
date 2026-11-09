# Handover — Hostarise AI Agent

Final documentation and handover (Milestone 13). Built 2026-11-09 on
branch `dev`, local commits only — **nothing has been pushed to
GitHub yet** (pushing needs the owner's Personal Access Token).

## 1. What this is

An autonomous Telegram-based technical support and operations platform
for Hostarise hosting support. Telegram is the primary control center;
there is no separate web dashboard. The owner runs it first on
Android + Termux; the architecture allows migration to a Linux VPS
without a rewrite.

## 2. Architecture

```
Telegram (grammY, src/telegram/)
   │  commands + plain-text messages, role-gated
   ▼
Task Manager (src/tasks/) ── persistent JSON queue, background run,
   │                          cancel, retry, execution logs
   ▼
AI Reasoning Engine (src/ai/) ── Gemini via provider abstraction
   │   (mock provider in tests / mock mode), classify → plan →
   │   tool loop, prompt-injection treated as data
   ├─► Knowledge Base (src/kb/, knowledge/*.md)
   ├─► Diagnostics (src/diagnostics/) — no browser needed
   ├─► Browser Engine (src/browser/) — Playwright, separate abstraction
   ├─► Replies (src/replies/) — Bengali + English customer drafts
   └─► Hosting Ops (src/ops/) — approval-gated, browser-backed
Security (src/security.js) guards every layer: SSRF, prompt
injection, path traversal, roles, redacted logs (src/logger.js).
Config (src/config.js) validates env, mock/live modes.
Entry: src/index.js (graceful SIGINT/SIGTERM shutdown).
```

## 3. Final folder structure

```
hostarise-ai-agent/
├── README.md                 # quick start, commands, limits
├── SPEC.md                   # master spec (13 milestones)
├── PROJECT-INTAKE.md         # background intake notes
├── package.json / package-lock.json
├── .env.example              # env template (never commit .env)
├── .gitignore
├── docs/
│   ├── MILESTONES.md         # per-milestone log with test evidence
│   ├── SETUP.md              # install, credentials, start/stop
│   ├── TERMUX.md             # Termux deployment (Milestone 12)
│   ├── VPS-MIGRATION.md      # VPS move + systemd + browser fallback
│   └── HANDOVER.md           # this file
├── knowledge/                # seed KB (dated, unverified notes only)
│   ├── hostarise-background.md
│   ├── support-playbook.md
│   └── customer-reply-rules.md
├── src/
│   ├── index.js              # entry + graceful shutdown
│   ├── config.js             # env loading + validation
│   ├── logger.js             # JSON logger, secret redaction
│   ├── security.js           # SSRF / injection / path / roles
│   ├── ai/                   # provider.js (Gemini+mock), reasoning.js
│   ├── browser/              # engine.js (Playwright), cpanel.js
│   ├── diagnostics/          # index, dns, ssl, http, email, wordpress, resources
│   ├── kb/                   # index.js (Markdown discovery/search)
│   ├── ops/                  # hosting.js (approval-gated ops)
│   ├── replies/              # generator.js (BN + EN replies)
│   ├── tasks/                # manager.js (persistent queue)
│   └── telegram/             # bot.js, handlers.js (13 commands)
├── test/unit/                # 7 test files, 90 tests
└── data/                     # runtime state (tasks.json, approvals.json)
```

## 4. Implemented features

- **Telegram control (M3):** 13 commands — `/start /help /status
  /diagnose /browse /test /screenshot /reply /knowledge /tasks
  /cancel /report` — plus plain-text and image handling, progress
  notifications, background tasks, cancellation, error reporting,
  conversation context, task history. Mock bot stand-in for tests.
- **AI reasoning (M4):** Gemini through a provider abstraction
  (mock provider for tests); classify task, pick tools, retrieve KB,
  plan investigation, execute permitted actions, evaluate results,
  final reports. Structured tool calling, retries, timeouts, graceful
  failure. Never invents diagnostic findings; unknown = unknown.
- **Knowledge base (M5):** Markdown discovery/search over
  `knowledge/`; distinguishes verified facts from assumptions. Seed
  docs are dated, unverified-background notes only (see §7).
- **Browser automation (M6):** Playwright, lazy import (app runs
  without a browser), isolated context per session, SSRF-safe URLs,
  CAPTCHA detection (never bypassed), cPanel login helpers with
  resilient field lookup, screenshots, 30 s / 10 s timeouts.
- **Diagnostics (M7):** DNS, SSL/HTTPS, HTTP codes, availability,
  email/SMTP + SPF/DKIM/DMARC, WordPress troubleshooting, server
  resources, PHP/MySQL/cPanel/WHM checks. Never claims to have
  inspected logs/DB/account settings without real access.
- **Customer replies (M8):** exactly ONE Bengali reply + ONE English
  reply per customer message; internal diagnosis kept separate; never
  asks for passwords/secrets; never invents policies, prices, or
  completed actions; KB gap → says the team will check and follow up.
- **Hosting ops (M9):** create email, change email password, quotas,
  subdomains, addon domains, DNS/SSL inspection, backups. Mutating
  or security-sensitive ops need an explicit approval record first;
  approvals persist in `data/approvals.json`; passwords never stored
  in records, payloads, or logs.
- **Task management + security (M10):** persistent JSON task queue,
  background execution, cancel/retry, execution logs, failure
  recovery; role-based access (owner / team / stranger); SSRF guard,
  prompt-injection guard, path guard, redacted logs.
- **Testing (M11):** see §5.

## 5. Test results (actually executed, 2026-11-09)

| Suite | File | Tests | Result |
|---|---|---|---|
| Telegram | `test/unit/telegram.test.js` | 17 | pass |
| AI reasoning | `test/unit/ai.test.js` | 13 | pass |
| Knowledge base | `test/unit/kb.test.js` | 7 | pass |
| Browser (real Chromium) | `test/unit/browser.test.js` | 11 | pass |
| Diagnostics | `test/unit/diagnostics.test.js` | 21 | pass |
| Replies + ops | `test/unit/replies-ops.test.js` | 11 | pass |
| Security | `test/unit/security.test.js` | 9 | pass |
| End-to-end (mock providers, local HTTP server) | `test/unit/e2e.test.js` | 1 | pass |
| **Total** | | **90** | **90 pass, 0 fail** |

- `npm run check` (syntax check over all `src/` files): **OK**.
- Full suite run 3 times in Milestone 11: 90/90 each time, no
  flakiness. Re-run after the mock-mode keep-alive fix (§6): 90/90.
- Commands: `npm test`, `npm run check`.
- Browser tests run against a **real Chromium** (Playwright
  chromium, installed during Milestone 6) and a local test website —
  not faked, not skipped.

## 6. Bugs found and fixed during the build

1. **TaskManager concurrent `save()` race** (integration): parallel
   saves raced on the shared `tasks.json.tmp` file → ENOENT, flaky
   suite (1–2 failures per run). Fixed by serializing saves through
   a promise chain; `close()` drains the in-flight save queue before
   the caller deletes the data dir (also fixed an ENOTEMPTY race in
   test teardown). Suite went from flaky to 0 failures in 20+ runs.
2. **Browser session leak** (integration): `closeAll()` did not run
   when `open()` threw after launching Chromium → leaked child
   process kept the Node event loop alive. Fixed: `closeAll()` now
   runs in `finally` even when `open()` throws.
3. **KB `loadKnowledgeBase` is async** (integration): call sites now
   await it. **Logger shape mismatch:** `runReasoning` expects a
   logger-shaped `log` (`.info`/`.warn`); TaskManager passes a plain
   function — adapted at the call site.
4. **`/browse` test URL** (integration): `https://8.8.8.8/` has no web
   server and hangs navigation; changed to `https://example.com/`.
5. **Mock mode exited immediately on `npm start`** (found during
   Milestone 12 verification, 2026-11-09): nothing held the event
   loop open, so the process exited ~0.14 s after starting. Fixed in
   `src/index.js` with a 60 s heartbeat interval in mock mode only
   (live mode is held open by grammY long polling). Verified: process
   stays alive under `timeout 5`, and SIGTERM shuts it down
   gracefully (`Shutdown complete.`). Tests unaffected (they never
   call `main()`); suite still 90/90 after the fix.
6. **Test-side fixes (no `src/` change):** missing `turnstile`
   CAPTCHA marker; missing `await` on `context.newPage()`; a
   `safeJoin` test that expected Windows-style `..\..\secret.txt`
   to be an escape (on Linux backslash is a literal character, so
   the path is inside the base and allowing it is correct).

## 7. Remaining limitations (honest)

- **Browser on Termux is NOT verified.** Playwright's official
  Android support is experimental; there is no official
  `chromium.launch()` inside Termux. Run Termux with
  `BROWSER_ENABLED=false` until physically tested on the owner's
  phone. Fallback: run the browser on a Linux VPS
  (`docs/VPS-MIGRATION.md` §6).
- **Knowledge-base facts are dated and unverified.** The seed KB
  uses Hostarise facts checked 2026-11-01 (plans ৳719–৳2,159/year,
  bKash/Nagad/Rocket/Upay/card, 7-day refund on annual plans; no VPS
  plan on homepage) and they are marked as such. **Ownership of
  Hostarise is NOT confirmed** (own site, supplier, or reference?).
  Prices/policies must be re-checked live before the KB is trusted
  for customer replies.
- **Live Telegram/Gemini have never run.** Everything was tested
  with mock providers. The first live run (after keys are entered)
  is a test run: `/status`, `/diagnose example.com`, one plain
  message — see `docs/SETUP.md` §6.
- **Live browser checks against public sites are unverified from
  the build machine** (sandbox proxy blocks them). Verify once on
  the real deployment with `/browse https://example.com`.
- **No `npm audit` data yet.** The sandbox registry policy blocks
  the audit endpoint (403). Re-run `npm audit` on a machine with
  normal registry access before treating dependencies as reviewed.
- **No KDP/real-customer data, no cPanel/WHM credentials** were ever
  used. cPanel helpers were tested against a local test site only;
  real cPanel layouts vary and the resilient lookup is the mitigation.
- **Not declared bug-free.** The suite covers the modules and the
  mocked end-to-end flow; real-world Telegram/Gemini/cPanel
  behaviour can still surprise. Report the first live-run results
  before relying on the agent for real customers.

## 8. Known issues

1. `npm audit` blocked in the sandbox (403, registry policy) — see §7.
2. Browser test logs a Playwright `ERR_TUNNEL_CONNECTION_FAILED`
   at `https://example.com` in this environment (proxy); the test
   passes because it asserts graceful failure handling.
3. `data/` is empty until the first run; `tasks.json` and
   `approvals.json` are created on demand.

## 9. What is needed from Nayem next (in order)

1. **Review this handover** and confirm the plan, or say what to
   change. Nothing is pushed anywhere yet.
2. **GitHub Personal Access Token** (classic, `repo` scope) — only
   when he wants the `dev` branch pushed to
   `hlwhkw123123-sudo/hostarisesupport`. To be pasted in a secure
   form, never in chat. The repo is public and empty; pushing will
   put the `dev` branch there. `main` stays untouched until the code
   is verified live.
3. **Telegram Bot Token + Gemini API Key** — only after (2), for the
   first live test run on Termux or VPS. See `docs/SETUP.md` §3 for
   how to get them. Do not send them until the code is pushed and
   the owner is ready to test live.
4. **Termux phone test** (or VPS test): install per `docs/TERMUX.md`,
   run `npm test`, start in mock mode, then live mode, and report
   the `/status` + `/diagnose` results.
5. **Hostarise facts decision:** confirm whether Hostarise is his own
   site, a supplier, or a reference — and confirm current plans /
   prices / refund policy — so the KB seed docs can be corrected
   from "unverified background" to verified facts.
6. **Browser-on-Termux decision:** try it on the phone, or accept
   the VPS fallback for browser work.

## 10. Do not do yet

- Do not push to `main`.
- Do not use the agent for real customers until the first live run
  (§9 step 4) passes.
- Do not enter real cPanel/WHM credentials anywhere until the live
  test run passes and the owner approves.
- Do not treat the mock-mode test results as proof the live
  Telegram/Gemini/cPanel paths work — they prove the logic, not the
  live connections.
