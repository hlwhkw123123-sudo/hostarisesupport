// Hosting Operations Engine (Milestone 9) — approval-gated.
// Performs hosting operations via the injected browser engine, but NEVER
// runs a mutating or security-sensitive operation without an explicit
// approval record first. Inspect-only ops may run immediately.
//
// Rules (SPEC sections 3F + 4):
// - Inspect-only: inspectDns, inspectSsl — may run immediately.
// - Mutating / security-sensitive: createEmail, changeEmailPassword,
//   setEmailQuota (alias: setQuota), createSubdomain, addAddonDomain,
//   runBackup — REQUIRE an approval record (status "approved") for that
//   op id. execute() refuses with a clear error otherwise.
// - Approvals are kept in memory and persisted to DATA_DIR/approvals.json.
// - Execution delegates to the injected browser object when one is
//   available; otherwise it returns { ok: false, reason: 'browser
//   unavailable — operation not performed' }. It never pretends an op ran.
// - Passwords are accepted only as function arguments. They are never
//   logged, never stored in the approval record, never persisted to
//   approvals.json, and never passed to the task manager payload.
//   The browser engine is the only recipient (it needs the value to
//   perform a password change) and only the op type + id are logged.
//
// The browser engine's exact method is not fixed yet (Milestone 6), so
// delegation tries, in order, browser.execute(op), browser.runOp(op),
// browser.performOperation(op) and browser.run(op). If none exists the op
// is reported as not performed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../logger.js';
import { getRole } from '../security.js';

export const OP_TYPES = new Set([
  'createEmail',
  'changeEmailPassword',
  'setEmailQuota',
  'createSubdomain',
  'addAddonDomain',
  'inspectDns',
  'inspectSsl',
  'runBackup',
]);

export const INSPECT_OPS = new Set(['inspectDns', 'inspectSsl']);

// Everything not inspect-only is mutating / security-sensitive.
export const MUTATING_OPS = new Set(
  [...OP_TYPES].filter((t) => !INSPECT_OPS.has(t)),
);

const TYPE_ALIASES = {
  setquota: 'setEmailQuota',
  setemailquota: 'setEmailQuota',
  createemail: 'createEmail',
  changeemailpassword: 'changeEmailPassword',
  createsubdomain: 'createSubdomain',
  addaddondomain: 'addAddonDomain',
  inspectdns: 'inspectDns',
  inspectssl: 'inspectSsl',
  runbackup: 'runBackup',
};

const SECRET_KEY_RE = /password|passwd|pwd|secret|token|api[_-]?key|otp|credential/i;

// Required fields per op type (checked before the approval check so a
// malformed op fails fast with a usable message).
const REQUIRED_FIELDS = {
  createEmail: [['email'], ['username', 'domain']],
  changeEmailPassword: [['email'], ['password', 'newPassword']],
  setEmailQuota: [['email'], ['quotaMB', 'quota', 'quotaMb']],
  createSubdomain: [['subdomain', 'domain']],
  addAddonDomain: [['domain']],
  inspectDns: [['domain', 'hostname']],
  inspectSsl: [['domain', 'hostname']],
  runBackup: [],
};

function canonicalType(rawType) {
  if (typeof rawType !== 'string') return null;
  return TYPE_ALIASES[rawType.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

// Deep-clone an object while dropping every key that looks like a secret
// (password, token, api key, ...) at any depth. Used for approval records,
// task payloads and anything persisted.
export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) continue;
      out[key] = stripSecrets(val);
    }
    return out;
  }
  return value;
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function missingFieldMessage(type, op) {
  for (const group of REQUIRED_FIELDS[type] || []) {
    const present = group.some((field) => op[field] !== undefined && op[field] !== null && op[field] !== '');
    if (!present) return `missing required field for ${type}: ${group.join(' or ')}`;
  }
  return null;
}

export function createOpsEngine({ browser = null, tasks = null, logger = null, config = {} } = {}) {
  const dataDir = config?.dataDir || process.env.DATA_DIR || './data';
  const file = path.join(dataDir, 'approvals.json');
  const approvals = new Map(); // opId -> approval record
  let loaded = false;
  let loadPromise = null;

  const log = (level, msg, meta) => {
    try {
      const fn = logger?.[level];
      if (typeof fn === 'function') fn(redact(msg), meta === undefined ? undefined : redact(meta));
    } catch { /* logging must never break an op */ }
  };

  async function ensureLoaded() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          await fs.mkdir(dataDir, { recursive: true });
          const raw = await fs.readFile(file, 'utf8');
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            for (const rec of arr) {
              if (rec && rec.opId) approvals.set(rec.opId, rec);
            }
          }
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
        loaded = true;
      })();
    }
    await loadPromise;
  }

  async function persist() {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...approvals.values()], null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  function findApproval(opId) {
    for (const rec of approvals.values()) {
      if (rec.opId === opId || rec.id === opId) return rec;
    }
    return null;
  }

  async function requestApproval(op = {}) {
    await ensureLoaded();
    const type = canonicalType(op.type);
    if (!type) {
      return { ok: false, reason: `unknown op type: ${op?.type ?? '(missing)'}. Known types: ${[...OP_TYPES].join(', ')}` };
    }
    const fieldError = missingFieldMessage(type, op);
    if (fieldError) return { ok: false, reason: fieldError };

    const opId = op.id || makeId('op');
    const existing = findApproval(opId);
    if (existing) return { ok: true, approval: existing, alreadyRequested: true };

    // Passwords/secrets are stripped before anything is stored or logged.
    const details = stripSecrets(op);
    delete details.id;
    delete details.type;
    const approval = {
      id: makeId('appr'),
      opId,
      type,
      status: 'pending',
      requestedBy: op.requestedBy ?? null,
      details,
      createdAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
    };
    approvals.set(opId, approval);
    await persist();
    log('info', `approval requested for ${type} ${opId}`, { type, opId });
    return { ok: true, approval };
  }

  async function approve(opId, approverId) {
    await ensureLoaded();
    const approval = findApproval(opId);
    if (!approval) {
      return { ok: false, reason: `no approval request found for op "${opId}"; request approval first` };
    }
    // Role check, enforced only when real numeric Telegram ids are
    // configured: owner/team may approve, anyone else may not. String
    // approver ids (external/test callers) are recorded as-is.
    if (config?.ownerTelegramId && typeof approverId === 'number') {
      const role = getRole(approverId, config);
      if (role === 'none') {
        log('warn', `approval refused for ${approval.type} ${approval.opId}: approver not authorized`, { type: approval.type, opId: approval.opId });
        return { ok: false, reason: 'approver is not authorized to approve hosting operations' };
      }
    }
    if (approval.status === 'approved') {
      return { ok: true, approval, alreadyApproved: true };
    }
    approval.status = 'approved';
    approval.approvedBy = approverId ?? null;
    approval.approvedAt = new Date().toISOString();
    await persist();
    log('info', `approval granted for ${approval.type} ${approval.opId}`, { type: approval.type, opId: approval.opId });
    return { ok: true, approval };
  }

  async function listApprovals() {
    await ensureLoaded();
    return [...approvals.values()];
  }

  async function getApproval(opId) {
    await ensureLoaded();
    return findApproval(opId);
  }

  async function execute(op = {}) {
    const type = canonicalType(op.type);
    if (!type) {
      return { ok: false, reason: `unknown op type: ${op?.type ?? '(missing)'}. Known types: ${[...OP_TYPES].join(', ')}` };
    }
    const opId = op.id || null;
    const fieldError = missingFieldMessage(type, op);
    if (fieldError) return { ok: false, opId, type, reason: fieldError };

    // Approval gate: every mutating / security-sensitive op needs an
    // approved approval record for its op id before it may run.
    if (MUTATING_OPS.has(type)) {
      await ensureLoaded();
      const approval = opId ? findApproval(opId) : null;
      if (!approval || approval.status !== 'approved') {
        const reason = `Operation ${type} (${opId || 'no id'}) requires approval before execution; no approved approval record found for this op. Request approval first.`;
        log('warn', `refused unapproved ${type} ${opId || '(no id)'}`, { type, opId });
        return { ok: false, opId, type, reason };
      }
    }

    // Browser delegation: no browser, no execution — never pretend it ran.
    if (!browser || config?.browserEnabled === false) {
      const reason = 'browser unavailable — operation not performed';
      log('warn', `cannot execute ${type} ${opId || '(no id)'}: ${reason}`, { type, opId });
      return { ok: false, opId, type, reason };
    }
    const method = ['execute', 'runOp', 'performOperation', 'run']
      .find((name) => typeof browser[name] === 'function');
    if (!method) {
      const reason = 'browser engine does not expose a supported operation method — operation not performed';
      log('warn', `cannot execute ${type} ${opId || '(no id)'}: ${reason}`, { type, opId });
      return { ok: false, opId, type, reason };
    }

    let result;
    try {
      // The full op (including a new password, when the op needs one) goes
      // to the browser only. Nothing containing it is logged or persisted.
      result = await browser[method](op);
    } catch (err) {
      const reason = `browser execution failed: ${redact(err?.message || String(err))} — operation may not have completed; verify before retrying`;
      log('error', `execution failed for ${type} ${opId || '(no id)'}`, { type, opId });
      return { ok: false, opId, type, reason };
    }

    const outcome = result && typeof result === 'object' && 'ok' in result
      ? { opId, type, ...result }
      : result
        ? { ok: true, opId, type, result }
        : { ok: false, opId, type, reason: 'browser engine returned no result — operation not performed' };

    // Audit trail via the task manager when one is injected. Payload is
    // secret-stripped; a failure to record never fails the op itself.
    try {
      if (tasks && typeof tasks.create === 'function') {
        tasks.create({
          type: 'hosting-op',
          title: `${type} ${opId || ''}`.trim(),
          payload: stripSecrets({ ...op, type }),
          createdBy: null,
        });
        if (typeof tasks.save === 'function') await tasks.save();
      }
    } catch { /* audit failure must not fail the op */ }

    log('info', `executed ${type} ${opId || '(no id)'} ok=${outcome.ok}`, { type, opId, ok: outcome.ok });
    return outcome;
  }

  return { requestApproval, approve, execute, listApprovals, getApproval };
}
