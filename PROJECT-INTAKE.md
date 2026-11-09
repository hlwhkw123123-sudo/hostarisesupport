# Hostarise AI Agent — Project Intake (prepared 2026-11-09, 20:09 Dhaka)

## What Nayem asked for (2026-11-09, WhatsApp side chat)
- Build the full "Hostarise AI Agent": an autonomous Telegram-based technical
  support and operations platform for Hostarise hosting support.
- "ami chai tumi eta fully amk banaiya deo" / "kmne banaba kivabe banaba ami
  jani na but banaiya deo" / "joto time laguk banao"
- "ekon ki ki access lagbe amk bolo ami dissi .. amar github er access
  kivabe dibo janaio"
- The master prompt (13 milestones) is the spec. It assumes an EXISTING
  GitHub repository with existing source files and existing Markdown
  knowledge-base documents, plus an existing Hostarise customer-response
  workflow (exactly one Bengali reply + exactly one English reply, no
  duplicated headings, internal diagnosis kept separate, never ask customers
  for passwords/API secrets).

## What the main agent already told him (2026-11-09 14:09:23Z)
- Only one thing is needed now: the GitHub repo link.
- Public repo: link alone is enough, it will be cloned.
- Private repo: a token is needed (GitHub Settings > Developer settings >
  Personal access tokens > Tokens (classic) > Generate new token, `repo`
  scope). Do NOT paste the token in chat; a secure form will be given.
- ZIP upload (Code > Download ZIP) is possible, but then pushing back to
  GitHub is not possible.
- Do NOT send the Telegram Bot Token or Gemini API Key yet; those come only
  after the build and mock tests are ready (prompt section 9).

## What is still missing — the 3 questions that block Milestone 1
1. **Repo link:** github.com/<owner>/<repo> — still not received.
2. **Does the repo exist, or is this a fresh build?** No Hostarise repo,
   source file, or knowledge-base Markdown file was found in this workspace
   or in memory. The prompt says "inspect the entire existing GitHub
   repository", but no repo name, link, or file was ever shared before
   2026-11-09. If there is no repo, Milestone 1 (audit) does not apply and
   work starts at Milestone 2 (fresh structure).
3. **Knowledge-base documents:** where are they? In the repo, in Google
   Drive, or only in Nayem's head / past chats? The customer-reply rules
   (Bengali + English, one each) must come from those documents, not be
   invented.

## What is already verified here (2026-11-09)
- Local workspace folder `~/workspace/hostarise-ai-agent/` exists but is
  EMPTY (created 2026-11-09 14:08, no files). No code has been written yet.
- Toolchain on this machine: git 2.43.0, Node.js v24.22.1, npm 10.9.4.
  grammY needs Node.js 20+, so the Node side is fine.
- Hostarise background (from 2026-11-01, not re-checked today):
  hostarise.cloud loads as a BDIX shared-hosting site, plans ৳719–৳2,159/year,
  no VPS plan on the homepage. Whether Hostarise is Nayem's own site, a
  supplier, or a reference is still NOT confirmed. hostarize.cloud did not
  resolve (DNS not found) on 2026-11-01.
- No Telegram Bot Token, Gemini key, cPanel/WHM credential, or GitHub token
  has been received, and none should be pasted in chat.

## Honest feasibility flags (checked 2026-11-09)
1. **Browser on Termux is the hard part, not the bot.** Playwright's
   official Android support is EXPERIMENTAL: it automates Chrome for
   Android / WebView through ADB, needs Chrome 105+, a device awake for
   screenshots, and "not everything works". There is no official
   `chromium.launch()` inside Termux. A third-party package
   (termux-playwright, PyPI) claims native Chromium via CDP without root,
   but that is unverified third-party material, not official Playwright.
   Consequence, exactly as the prompt itself says: build the browser engine
   as a separate abstraction, do NOT claim Termux browser support until it
   is physically tested on Nayem's phone, and keep the fallback of running
   the browser on a separate Linux service / VPS.
2. **Telegram + Gemini + diagnostics (no browser) can start first.**
   grammY on Node.js is standard. DNS/SSL/HTTP/email checks do not need a
   browser. So Milestones 3–5 and 7 (Telegram, AI reasoning, knowledge base,
   diagnostics) can be built and mock-tested before the browser question
   is settled.
3. **Scope is large.** 13 milestones, cPanel/WHM operations, approval
   workflows, full test suites. This is not a one-night build even with
   "joto time laguk". Realistic order: M1 audit (once the repo is known)
   → M2 skeleton + .env.example + mock providers → M3 Telegram commands
   → M4 Gemini provider → M5 knowledge base → M6 browser (test on Termux,
   decide fallback) → M7–M10 diagnostics / replies / operations / security
   → M11 tests → M12 Termux docs → M13 handover. No live keys until M11
   mock tests pass.
4. **Security rules from the prompt to keep:** env-based secrets, redacted
   logs, isolated browser sessions, role-based access, approval before any
   destructive / security-sensitive operation, never store customer cPanel
   passwords in logs, Gemini prompts, or permanent history, never bypass
   CAPTCHA / MFA, never invent a diagnostic finding.

## GitHub access — the 3 options (for Nayem, in short)
- **A. Public repo:** just send the link. Nothing else needed.
- **B. Private repo:** send the link + give access ONE of these ways:
  (i) collaborator invite (repo Settings > Collaborators), or
  (ii) a classic Personal Access Token with `repo` scope, pasted ONLY in
  the secure form when offered, never in chat. A token can be revoked
  after the work; a collaborator invite can be removed.
- **C. No GitHub yet / repo does not exist:** say so plainly. Then the
  build starts fresh here, and a new repo is created only when Nayem
  says where (his account, and under what name).
- In every case: Telegram Bot Token and Gemini API Key come LATER, after
  build + mock tests. No cPanel/WHM password is needed during development.

## Next step when the link arrives
1. Clone / inspect the repo (or confirm fresh build).
2. Run Milestone 1 audit: file list, dependencies, KB docs inventory,
   working vs broken vs incomplete, and a short architecture + plan.
3. Report the audit to Nayem BEFORE writing new code, per the prompt.
4. Create a tracked item for this project (goal/tracking create was not
   available in this research run; the main agent should create it when
   the repo question is settled).

## Sources
- Nayem's master prompt + 4 follow-ups, WhatsApp side chat,
  2026-11-09 14:07:52–14:08:48Z.
- Main agent's reply asking for the repo link, 2026-11-09 14:09:23Z.
- Hostarise site check, 2026-11-01 (memory/2026-11-01.md).
- Playwright Android docs (experimental, ADB, Chrome 105+):
  https://playwright.dev/docs/api/class-android
- termux-playwright PyPI page (third-party, unverified):
  https://pypi.org/project/termux-playwright/
- grammY getting started: https://grammy.dev/guide/getting-started.html
