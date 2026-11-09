# VPS Migration — Hostarise AI Agent

How to move the agent from Termux (Android) to a Linux VPS, or run it
on a VPS from the start. No code rewrite is needed: the agent is
env-based and modular by design (SPEC §7).

> **Status: procedure written, NOT yet run on a real VPS.** The steps
> are the standard ones for a Node.js app; the first real migration
> should be treated as a test run and any deviation recorded here.

## 1. Why move

- Termux can be suspended by Android; a VPS runs 24/7.
- The browser engine (Playwright/Chromium) is **not verified on
  Termux** but runs on Linux — on a VPS `BROWSER_ENABLED=true` works
  and `/browse`, `/screenshot` and browser-backed hosting ops become
  available.
- More stable network for Telegram long polling.

## 2. Pick a VPS

Minimum that fits this app:

- 1 vCPU, 1 GB RAM, 20 GB disk. Node.js + Chromium need the RAM;
  do not go below 1 GB if the browser engine will run.
- Ubuntu 22.04 or 24.04 LTS (or Debian 12).
- Any provider the owner already uses. Nothing in this repo is tied
  to a provider.

## 3. Install on the VPS

```bash
# As a non-root user with sudo, or root.
apt update && apt upgrade -y
apt install -y git curl

# Node.js 20+ (NodeSource for Ubuntu/Debian):
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version   # must be 20 or newer
```

Then the app (same as anywhere else):

```bash
git clone https://github.com/hlwhkw123123-sudo/hostarisesupport.git hostarise-ai-agent
cd hostarise-ai-agent
git checkout dev
npm install
```

Install the browser (only if `BROWSER_ENABLED=true`):

```bash
npx playwright install chromium
npx playwright install-deps chromium   # system libs Chromium needs (Debian/Ubuntu)
npm test        # expect: 90 pass, 0 fail
```

## 4. Configure

```bash
cp .env.example .env
```

Fill in the same variables as on Termux (see `docs/SETUP.md`), with
two changes:

```env
MOCK_MODE=false
BROWSER_ENABLED=true
```

Copy the Termux data directory if there is task/approval history to
keep:

```bash
# on the phone (Termux):
tar czf hostarise-data.tar.gz -C ~/hostarise-ai-agent data
# transfer the tarball to the VPS (scp/sftp), then on the VPS:
tar xzf hostarise-data.tar.gz -C ~/hostarise-ai-agent
```

`tasks.json` and `approvals.json` are plain JSON; they move as-is.
Do **not** copy `.env` by an insecure channel — re-create it on the
VPS, or copy it over `scp` only.

## 5. Run it as a service (systemd)

So the agent restarts on boot and after a crash. Create
`/etc/systemd/system/hostarise-agent.service` (adjust the user and
paths):

```ini
[Unit]
Description=Hostarise AI Agent (Telegram support bot)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hostarise
WorkingDirectory=/home/hostarise/hostarise-ai-agent
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now hostarise-agent
systemctl status hostarise-agent
journalctl -u hostarise-agent -f   # live logs
```

Stop / restart:

```bash
systemctl stop hostarise-agent
systemctl restart hostarise-agent
```

`SIGTERM` (what systemd sends on stop) triggers the agent's graceful
shutdown: bot stops, task state is saved, `Shutdown complete.` is
logged.

## 6. Browser on the VPS (the Termux fallback)

On a Linux VPS the browser engine runs for real: Playwright launches
its own Chromium, one isolated context per session, with the SSRF
guard, CAPTCHA detection (never bypassed) and 30 s navigation /
10 s action timeouts. This is the supported place to run
`/browse`, `/screenshot` and cPanel browser ops.

Keep in mind:

- The sandbox proxy on the **build** machine blocked public-site
  fetches (`ERR_TUNNEL_CONNECTION_FAILED`); that is an environment
  quirk, not an app bug. On a real VPS, verify once with
  `/diagnose example.com` and `/browse https://example.com` and
  confirm both return real results.
- cPanel selectors differ between hosts: the cPanel helper inspects
  fields resiliently (placeholder → aria-label → name → id → label
  text) and never assumes one host's layout.

## 7. Backups

Back up two things:

1. `data/` — `tasks.json`, `approvals.json` (small JSON files).
2. `.env` — or at least the knowledge of where the keys live
   (BotFather, AI Studio); keys can be re-created, but a lost
   `.env` means re-entering them.

```bash
# example nightly backup (cron):
0 3 * * * tar czf /root/backups/hostarise-$(date +\%F).tar.gz -C /home/hostarise/hostarise-ai-agent data
```

Keep backups off the VPS (download them, or sync to other storage).
Never commit `data/` or `.env` to git.

## 8. Health checks

- `/status` in Telegram: mode, browser availability, task counts.
- `systemctl is-active hostarise-agent` on the VPS.
- `journalctl -u hostarise-agent --since "1 hour ago"` for recent
  errors. Logs are redacted; a token or password will never appear
  there.
- `npm test` after every `git pull` before restarting the service.
  If tests fail, do not restart with the new code — report the
  failure first.
