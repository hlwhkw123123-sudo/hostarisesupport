# Hostarise AI Agent

Autonomous Telegram-based technical support and operations platform for
Hostarise hosting support. Telegram is the primary control center; no
separate web dashboard is needed for normal operations.

## Status

Under active development on the `dev` branch. See `docs/MILESTONES.md`
for per-milestone progress and test results.

## Quick start (mock mode — no keys needed)

```bash
npm install
cp .env.example .env   # leave MOCK_MODE=true
npm test               # mock test suite
npm start              # starts the bot in mock mode
```

## Live mode

1. Copy `.env.example` to `.env`.
2. Set `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `OWNER_TELEGRAM_ID`.
3. Set `MOCK_MODE=false`.
4. `npm start`.

Full instructions: `docs/SETUP.md` (Milestone 12/13).

## Commands

`/start` `/help` `/status` `/diagnose` `/browse` `/test` `/screenshot`
`/reply` `/knowledge` `/tasks` `/cancel` `/report`

## Architecture

- `src/telegram/` — grammY bot, commands, handlers
- `src/ai/` — Gemini provider abstraction + reasoning engine
- `src/kb/` — Markdown knowledge-base engine
- `src/browser/` — Playwright automation (separate abstraction)
- `src/diagnostics/` — DNS, SSL, HTTP, email, WordPress, cPanel/WHM checks
- `src/replies/` — Bengali + English customer reply generation
- `src/ops/` — approval-gated hosting operations
- `src/tasks/` — persistent task queue and background execution
- `src/security.js` — SSRF guard, prompt-injection guard, roles
- `src/config.js`, `src/logger.js` — config validation, redacting logger

## Important limits (honest)

- Browser automation on Termux (Android) is NOT verified. Playwright's
  official Android support is experimental. The browser engine is a
  separate abstraction so it can run on a Linux service/VPS instead.
  See `docs/TERMUX.md`.
- No real Telegram/Gemini credentials are stored in this repo. Tests use
  mock providers.
