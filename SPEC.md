# Hostarise AI Agent — Master Spec (condensed from Nayem's master prompt, 2026-11-09)

## 0. Repo state
- GitHub repo `hlwhkw123123-sudo/hostarisesupport` is EMPTY (verified 2026-11-09: `git ls-remote` returns no refs, clone warns "empty repository").
- There is NO existing source code and NO existing knowledge-base Markdown to preserve.
- Milestone 1 (repository audit) therefore does NOT apply. Work starts at Milestone 2 (fresh structure).
- Local folder `~/workspace/hostarise-ai-agent/` is connected to that repo as `origin` (branch `main`, no commits yet).
- Work on a `dev` branch with small commits. Never push unverified code to `main`. Pushing to GitHub needs the owner's Personal Access Token (repo scope) later; do NOT invent one, do NOT ask for it until code is ready to push.

## 1. Objective
Autonomous Telegram-based technical support and operations platform for Hostarise hosting support. Telegram is the primary control center; no separate web dashboard needed for normal operations. Owner runs it first on Android + Termux; architecture must allow future migration to a Linux VPS without a rewrite.

## 2. Stack
- Node.js (v24 available here; grammY needs 20+), grammY for Telegram.
- Gemini API through a dedicated provider abstraction (mock provider for tests).
- Playwright for browser automation, as a separate abstraction (see §6).
- No unnecessary dependencies. No hardcoded secrets; `.env.example` + config validation.

## 3. Architecture (modular)
- **A. Telegram Control System (grammY):** commands /start /help /status /diagnose /browse /test /screenshot /reply /knowledge /tasks /cancel /report; plain-message input; text+image processing; screenshot/document delivery; progress notifications; background tasks; cancellation; error reporting; conversation context; task history.
- **B. AI Reasoning Engine (Gemini abstraction):** understand instructions, classify task, pick tools, retrieve KB info, plan investigation, execute permitted actions, evaluate results, decide next steps, final reports. Structured tool calling, context management, retries, API error handling, model config, token/request management, timeouts, graceful failure. NEVER invent diagnostic findings; unknown = unknown.
- **C. Browser Automation Engine (Playwright):** real browser: open/navigate/click/fill forms/login workflows/inspect content/screenshots/download/upload; operate authorized cPanel; verify results. Isolated contexts/sessions, timeouts, recovery, logging, screenshots. NEVER bypass CAPTCHA/MFA/access restrictions; ask a human when needed. Do NOT assume identical cPanel selectors; inspect resiliently.
- **D. Technical Diagnostics Engine (no browser needed):** domain/DNS, SSL/HTTPS, HTTP codes, availability, email/SMTP, SPF/DKIM/DMARC, PHP config/errors, MySQL connectivity, WordPress troubleshooting, cPanel diagnostics, WHM diagnostics, server resources, page-load/browser errors, application errors. NEVER claim to have inspected logs/DB/account settings unless access existed and inspection happened.
- **E. Customer Communication Engine:** process copied customer messages (WhatsApp/email/live chat/tickets). Understand intent, identify issue, consult KB, generate accurate replies in Bengali AND English, professional human-like, no unnecessary technical detail. Existing workflow: exactly ONE Bengali reply + exactly ONE English reply, never duplicate headings/paragraphs, internal diagnosis separate from customer replies, NEVER ask customers for passwords/API secrets, NEVER invent policies/prices/completed actions.
- **F. Hosting Operations Engine (modular, approval-gated):** create email accounts, change email passwords, manage quotas, subdomains, addon domains, DNS records, SSL status, file upload/management, database inspection, approved backups, config diagnosis. Browser automation or authorized APIs. Explicit approval BEFORE any destructive or security-sensitive operation.
- **G. Knowledge Base Engine:** Markdown docs; discover/read/retrieve relevant info; no duplicate content; respect existing instructions; distinguish verified facts from assumptions. Maintainable structure for adding docs later. SEED KB ONLY from verified public facts (see §8); everything else marked as assumption/unverified.
- **H. Task Management Engine:** queue, background execution, task IDs, progress tracking, cancellation, retry policies, persistent state, execution logs, failure recovery. Long tasks must not block Telegram handling.

## 4. Security (mandatory)
Env-based secrets; secure credential handling; redacted logs; isolated browser sessions; role-based authorization; configurable owner/team access; secure session cleanup; input validation; command restrictions; prompt-injection protection; SSRF + unauthorized-network protection; safe file operations; approval workflows for sensitive actions. Public customer-message processing must NOT grant privileged hosting ops. Secure enrollment/authorization for team members, never a hardcoded public-access config. NEVER store customer cPanel passwords in logs, Gemini prompts, or permanent history.

## 5. Termux compatibility
Must support Termux Node.js, handle Android interruptions, graceful shutdown, network drops, clear startup diagnostics/errors. Browser engine architected independently so it can run on a separate Linux service if Android Chromium fails.

## 6. Browser on Termux — HONEST LIMIT (verified 2026-11-09)
Playwright's official Android support is EXPERIMENTAL (automates Chrome for Android/WebView via ADB, needs Chrome 105+, device awake for screenshots, "not everything works"). There is NO official `chromium.launch()` inside Termux. A third-party package (termux-playwright, PyPI) claims native Chromium via CDP without root but is UNVERIFIED third-party material. Consequence: build the browser engine as a separate abstraction, do NOT claim Termux browser support until physically tested on Nayem's phone, keep the fallback of running the browser on a separate Linux service / VPS. Telegram + Gemini + diagnostics (no browser) come first.

## 7. VPS migration (prepare, don't depend on it)
Env-independent config, modular services, process-manager compatibility, persistent storage abstraction, browser service abstraction, structured logging, health checks, deployment docs, backup/recovery docs.

## 8. Known Hostarise facts (checked 2026-11-01, NOT re-checked; ownership NOT confirmed)
- hostarise.cloud loads: BDIX shared web hosting, plans ৳719–৳2,159/year (Nano 10GB ৳719/yr), bKash/Nagad/Rocket/Upay/card, 7-day refund on annual plans. No VPS plan on homepage.
- Whether Hostarise is Nayem's own site, a supplier, or a reference is NOT confirmed.
- hostarize.cloud did NOT resolve (DNS not found) on 2026-11-01.
- Seed the KB with these facts ONLY as dated, unverified-background notes. Never present them as certain. Never invent prices/policies.

## 9. Credentials
Owner provides Telegram Bot Token + Gemini API Key ONLY after codebase + local mock test suite are ready. Until then: `.env.example`, config validation, mock providers for tests. Never hardcode credentials, never create fake credentials, never commit `.env`, never require real customer credentials in dev tests. Prepare a clear credential configuration guide.

## 10. Testing (mandatory, not optional)
- Static: syntax, type checks where applicable, linting, dependency validation, security/dependency audits.
- Unit: every independent module.
- Integration (mocked): Telegram updates, Gemini responses, KB retrieval, browser tasks, diagnostics, reply generation, task queue.
- Browser: local test website/controlled env: startup, navigation, forms, buttons, screenshots, error detection, session cleanup, failure recovery.
- Security: unauthorized privileged ops, credential leakage, prompt injection, unsafe URLs, file access, destructive-op approval, log redaction.
- End-to-end: customer issue → analysis → diagnostics → missing info → plan → approved op → verify → Telegram report; plus reply generation alone.
- Do NOT report a test as passed unless actually executed.

## 11. Milestones (sequential; test + fix + record after each; continue only on acceptance)
1. Repo audit — N/A (empty repo; record this).
2. Core project structure.
3. Telegram Control System.
4. AI Reasoning Engine.
5. Knowledge Base Integration.
6. Browser Automation Engine.
7. Technical Diagnostics.
8. Customer Communication Engine.
9. Hosting Operations.
10. Task Management and Security.
11. Complete Testing and Bug Fixing.
12. Termux Deployment Preparation.
13. Final Documentation and Handover.

## 12. Final acceptance (ready for owner testing only when)
All modules implemented; no known critical/high bugs; all automated tests pass; integration tests pass with mocked services; browser tests pass in a supported env; security checks done; config documented; Termux limits documented; startup/shutdown documented; KB preserved (here: seeded honestly); owner can configure credentials alone. Do NOT claim bug-free or fully tested everywhere. Provide an honest, evidence-based verification report.

## 13. Handover contents
Architecture, final folder structure, implemented features, completed milestones, automated/integration/browser/security test results, remaining limitations, known issues, Termux install instructions, env config instructions, bot start/stop instructions, VPS migration instructions. Do NOT ask for Telegram/Gemini keys until dev + mock testing are complete. Do NOT declare complete prematurely.
