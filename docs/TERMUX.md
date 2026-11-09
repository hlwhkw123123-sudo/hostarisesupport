# Termux Deployment — Hostarise AI Agent

How to run the agent on an Android phone with Termux. This is
Milestone 12 (Termux Deployment Preparation).

> **Status: procedure written, NOT yet verified on a real phone.**
> Every step below must be run once on the owner's phone before it can
> be called working. Nothing in this file was tested on Android — the
> build and test machine is Linux. Report any step that fails; do not
> work around a failure silently.

## 1. What runs on Termux, and what does not

| Part | On Termux | Notes |
|---|---|---|
| Telegram bot (grammY) | Yes | Pure Node.js, no native code. |
| Gemini AI engine | Yes | HTTPS calls only. |
| Diagnostics (DNS/SSL/HTTP/email/WP) | Yes | Pure Node.js + DNS lookups. |
| Knowledge base, replies, ops, tasks | Yes | Files + JSON only. |
| **Browser engine (Playwright/Chromium)** | **NO — not verified** | See §5. Run with `BROWSER_ENABLED=false` on Termux. |

Telegram + Gemini + diagnostics (no browser) come first. That is the
supported Termux configuration.

## 2. Install (on the phone, in Termux)

```bash
pkg update && pkg upgrade
pkg install nodejs git
node --version   # must be 20 or newer (grammY needs 20+)
git --version
```

Get the code (first time):

```bash
git clone https://github.com/hlwhkw123123-sudo/hostarisesupport.git hostarise-ai-agent
cd hostarise-ai-agent
git checkout dev
npm install
```

Update later:

```bash
cd hostarise-ai-agent
git pull origin dev
npm install
```

## 3. Configure

```bash
cp .env.example .env
```

Edit `.env` (use `nano .env` in Termux). See `docs/SETUP.md` for every
variable and how to get the keys. Minimum for live mode on Termux:

```env
TELEGRAM_BOT_TOKEN=<token from @BotFather>
GEMINI_API_KEY=<key from Google AI Studio>
OWNER_TELEGRAM_ID=<your Telegram user id>
MOCK_MODE=false
BROWSER_ENABLED=false
DATA_DIR=./data
LOG_LEVEL=info
```

`BROWSER_ENABLED=false` is **required** on Termux until browser support
is physically tested on the phone (see §5). With it off, `/browse`,
`/screenshot` and browser-backed ops answer that the browser is
unavailable instead of crashing.

First run in mock mode (no keys needed) to prove the install works:

```bash
npm test        # expect: 90 pass, 0 fail
npm start       # expect: "mock Telegram bot started", process stays running
```

Press `Ctrl+C` to stop. Then fill in the real keys and start in live mode.

## 4. Start, stop, keep alive

Start (foreground):

```bash
cd ~/hostarise-ai-agent
npm start
```

Stop: `Ctrl+C`, or from another Termux session `kill <pid>`.
The agent handles `SIGINT`/`SIGTERM` gracefully: it stops the bot,
finishes the in-flight task save, and logs `Shutdown complete.`

Keep it running when the screen is off:

```bash
termux-wake-lock
```

Run that once per Termux session before `npm start`. Without a wake
lock Android may suspend Termux and the bot will stop answering.
(A wake lock does not survive a reboot; re-run it after restarting
the phone.)

Optional — survive Termux restarts with a boot script (Termux:Boot
app, not installed by default). This is a convenience, not required:

```bash
# ~/.termux/boot/start-hostarise.sh  (needs the Termux:Boot app)
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/hostarise-ai-agent && npm start
```

## 5. Browser on Termux — the honest limit

Playwright's official Android support is **experimental**: it automates
Chrome for Android / WebView via ADB, needs Chrome 105+, needs the
device awake for screenshots, and "not everything works". There is
**no official `chromium.launch()` inside Termux**. A third-party
package (`termux-playwright`, PyPI) claims native Chromium via CDP
without root, but it is **unverified third-party material** and was
not tested here.

Consequences:

- Do **not** claim browser automation works on Termux until it has
  been physically tested on the owner's phone.
- The browser engine is a separate abstraction (`src/browser/`), so
  the rest of the agent runs fine with `BROWSER_ENABLED=false`.
- If browser work is needed, the supported fallback is running the
  browser on a separate Linux service / VPS — see
  `docs/VPS-MIGRATION.md`. The agent code does not need a rewrite for
  that; only the deployment changes.
- If the owner wants to try `termux-playwright` on the phone, treat
  it as an experiment: install it, run `npm test` (browser tests use a
  local server), and record exactly what passed/failed before relying
  on it.

## 6. Android interruptions and network drops

- The bot uses Telegram long polling (grammY default). A network drop
  makes grammY retry; the process does not exit on a transient
  failure. If the process does exit, restart it with `npm start`.
- Task state is persistent (`DATA_DIR/tasks.json`): a task that was
  running when the process died stays recorded; re-run it with
  `/tasks` / `/report` rather than assuming it finished.
- Logs are JSON lines on stdout. In Termux, capture them when
  debugging: `npm start 2>&1 | tee agent.log`. Secrets are redacted
  from logs by `src/logger.js`; never paste a raw `.env` anywhere.
- Storage: `data/` holds `tasks.json` and `approvals.json`. Back it up
  before reinstalling Termux or the repo (`cp -r data data.bak`).

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| `node: command not found` | `pkg install nodejs`, then `node --version` |
| `npm install` fails | Check network; `pkg update` first; Node 20+ required |
| Startup exits with config errors | Read the error: live mode needs `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `OWNER_TELEGRAM_ID` |
| Bot starts then exits immediately | Fixed in this version (mock-mode heartbeat). If it still happens, run `npm test` and report the output |
| Bot does not answer on Telegram | Check the token, check `OWNER_TELEGRAM_ID`, check the phone has network, check `termux-wake-lock` is on |
| `/browse` says browser unavailable | Expected on Termux (`BROWSER_ENABLED=false`). See §5 |
| `npm audit` fails | Known sandbox issue on the build machine only; run it on a normal machine (see `docs/HANDOVER.md`) |
