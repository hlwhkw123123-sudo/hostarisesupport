# Setup and Configuration — Hostarise AI Agent

Milestone 12/13. How to configure the agent and start it, on Termux
or on any Linux machine.

## 1. Requirements

- Node.js **20 or newer** (`node --version`). The build machine uses
  Node v24.
- `git`, `npm` (ships with Node).
- For live mode: a Telegram bot token and a Gemini API key (see §3).
  For mock mode: nothing.

## 2. Install

```bash
git clone https://github.com/hlwhkw123123-sudo/hostarisesupport.git hostarise-ai-agent
cd hostarise-ai-agent
git checkout dev
npm install
npm test        # expect: 90 pass, 0 fail
```

## 3. Get the credentials (live mode only)

Do this **only after** the mock test suite passes. Never paste a real
key into chat, a file that gets committed, or a screenshot.

### Telegram Bot Token

1. Open Telegram, talk to **@BotFather**.
2. Send `/newbot`, follow the prompts (pick a name and a username).
3. BotFather replies with a token like `123456789:AAE...`. That is
   `TELEGRAM_BOT_TOKEN`.
4. Start a chat with your new bot once (send it any message), so it
   can reply to you.

### Your Telegram user ID (`OWNER_TELEGRAM_ID`)

The owner ID is who may run privileged commands (`/diagnose`,
`/browse`, `/reply`, ops, …). Strangers are refused.

1. Open Telegram, talk to **@userinfobot** (or **@getmyid_bot**).
2. It replies with your numeric user ID.
3. That number is `OWNER_TELEGRAM_ID`.

### Gemini API Key

1. Go to Google AI Studio: <https://aistudio.google.com/>.
2. Sign in with a Google account, open **Get API key** / **Create API
   key**.
3. That key is `GEMINI_API_KEY`.
4. Default model is `gemini-1.5-flash` (`GEMINI_MODEL`). The key is
   billed per Google's current AI Studio terms; check the quota page
   in AI Studio if calls start failing.

### Team members (optional)

`TEAM_TELEGRAM_IDS` — comma-separated numeric Telegram user IDs.
Team members may run `/status` and other safe commands, but **not**
privileged commands. Leave it empty if there is no team yet.

## 4. Environment variables

Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | live only | — | Bot token from @BotFather |
| `GEMINI_API_KEY` | live only | — | Key from Google AI Studio |
| `OWNER_TELEGRAM_ID` | live only | — | Numeric Telegram user ID of the owner |
| `TEAM_TELEGRAM_IDS` | no | — | Comma-separated numeric team IDs |
| `MOCK_MODE` | no | `true` | `true` = mock providers, no real calls; `false` = live |
| `BROWSER_ENABLED` | no | `true` | `false` disables the browser engine entirely |
| `GEMINI_MODEL` | no | `gemini-1.5-flash` | Gemini model name |
| `GEMINI_TIMEOUT_MS` | no | `60000` | Gemini call timeout (ms) |
| `DATA_DIR` | no | `./data` | Task queue + approvals storage |
| `LOG_LEVEL` | no | `info` | `error`, `warn`, `info`, `debug` |

Rules:

- **Never commit `.env`.** It is in `.gitignore`. If a key is ever
  committed by accident, revoke it immediately (BotFather
  `/revoke`, AI Studio key deletion) and create a new one.
- Mock mode needs **no** credentials: `MOCK_MODE=true` (the default)
  runs the whole suite and the bot without any real call.
- Live mode refuses to start without token + key + owner ID, and
  prints exactly which variable is missing.
- On Termux set `BROWSER_ENABLED=false` (see `docs/TERMUX.md` §5).

## 5. Start and stop

```bash
npm start
```

Expected output (mock mode):

```
{"level":"info","msg":"Hostarise AI Agent starting","meta":"{\"mockMode\":true}"}
{"level":"warn","msg":"Running in MOCK MODE: no real Telegram/Gemini calls will be made."}
{"level":"info","msg":"mock Telegram bot started (no Telegram calls will be made)"}
```

The process stays running. In live mode it connects to Telegram with
long polling and answers commands.

Stop with `Ctrl+C` (SIGINT) or `kill <pid>` (SIGTERM). Shutdown is
graceful: the bot stops, pending task state is saved, and the log
shows `Shutdown complete.`

## 6. First live checks

After starting in live mode, in Telegram with the owner account:

1. `/start` — bot answers with the welcome/help text.
2. `/status` — bot reports mode, browser availability, task counts.
3. `/diagnose example.com` — runs a real diagnostic (no browser).
4. `/knowledge` — shows the knowledge-base topics.
5. Send a plain message like `my website is down` — the bot
   classifies it, runs diagnostics, and replies with a Bengali +
   English draft pair.

If any of these fails, read the log first: it prints redacted errors
with the cause. Secrets never appear in logs.

## 7. Commands

`/start` `/help` `/status` `/diagnose` `/browse` `/test`
`/screenshot` `/reply` `/knowledge` `/tasks` `/cancel` `/report`

Plus plain-text messages (classified by the AI engine) and image
messages. Privileged commands refuse strangers and non-owner team
members; see `docs/HANDOVER.md` for the access rules.

## 8. Data and logs

- `DATA_DIR` (default `./data/`): `tasks.json` (persistent task
  queue), `approvals.json` (hosting-op approvals). Back these up
  before reinstalling or moving the agent.
- Logs are JSON lines on stdout. Redirect to a file when debugging:
  `npm start 2>&1 | tee agent.log`.
- Never store customer cPanel passwords in logs, Gemini prompts, or
  permanent history. The ops engine accepts passwords only as
  function arguments and strips them from every stored record.
