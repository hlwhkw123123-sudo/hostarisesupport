// Task manager: persistent queue with background execution, progress,
// cancellation, retry and execution logs. State is stored as JSON in
// DATA_DIR/tasks.json so tasks survive restarts. Long tasks run async and
// never block the Telegram message loop.
import fs from 'node:fs/promises';
import path from 'node:path';

const RETRY_DELAYS_MS = [1000, 5000, 15000];

export class TaskManager {
  constructor({ dataDir, logger, maxRetries = 3 } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'tasks.json');
    this.logger = logger;
    this.maxRetries = maxRetries;
    this.tasks = new Map();
    this.running = new Map(); // id -> { cancelRequested }
    this.handlers = new Map(); // type -> async (task, onProgress) => result
    this.loaded = false;
  }

  registerHandler(type, fn) {
    this.handlers.set(type, fn);
  }

  async load() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const arr = JSON.parse(raw);
      for (const t of arr) {
        // Tasks that were running when the process died go back to queued.
        if (t.status === 'running') t.status = 'queued';
        this.tasks.set(t.id, t);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.loaded = true;
  }

  async save() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify([...this.tasks.values()], null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  create({ type, title, payload = {}, createdBy = null }) {
    const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const task = {
      id, type, title, payload, createdBy,
      status: 'queued', progress: 0, progressNote: '',
      attempts: 0, result: null, error: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      log: [],
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id) { return this.tasks.get(id) || null; }

  list({ status = null, limit = 20 } = {}) {
    const all = [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (status ? all.filter((t) => t.status === status) : all).slice(0, limit);
  }

  async cancel(id) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, reason: 'task not found' };
    if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
      return { ok: false, reason: `task already ${task.status}` };
    }
    const run = this.running.get(id);
    if (run) run.cancelRequested = true;
    task.status = 'cancelled';
    task.updatedAt = new Date().toISOString();
    task.log.push(`${new Date().toISOString()} cancelled`);
    await this.save();
    return { ok: true, task };
  }

  async run(id) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task not found: ${id}`);
    const handler = this.handlers.get(task.type);
    if (!handler) {
      task.status = 'failed';
      task.error = `no handler registered for type "${task.type}"`;
      await this.save();
      return task;
    }
    const runState = { cancelRequested: false };
    this.running.set(id, runState);
    task.status = 'running';
    task.attempts += 1;
    task.updatedAt = new Date().toISOString();
    await this.save();

    const onProgress = async (pct, note) => {
      task.progress = pct;
      task.progressNote = note || '';
      task.updatedAt = new Date().toISOString();
      await this.save();
    };
    const log = async (line) => {
      task.log.push(`${new Date().toISOString()} ${line}`);
      await this.save();
    };

    try {
      const result = await handler(task, onProgress, log, runState);
      if (runState.cancelRequested) {
        task.status = 'cancelled';
      } else {
        task.status = 'done';
        task.progress = 100;
        task.result = result ?? null;
      }
    } catch (err) {
      this.logger?.error(`task ${id} failed: ${err.message}`);
      if (task.attempts < this.maxRetries && !runState.cancelRequested) {
        const delay = RETRY_DELAYS_MS[Math.min(task.attempts - 1, RETRY_DELAYS_MS.length - 1)];
        task.status = 'queued';
        task.error = err.message;
        task.log.push(`${new Date().toISOString()} attempt ${task.attempts} failed (${err.message}); retry in ${delay}ms`);
        await this.save();
        await new Promise((r) => setTimeout(r, delay));
        this.running.delete(id);
        return this.run(id);
      }
      task.status = 'failed';
      task.error = err.message;
    }
    task.updatedAt = new Date().toISOString();
    this.running.delete(id);
    await this.save();
    return task;
  }

  // Fire-and-forget: queue a task and run it in the background.
  async enqueue(taskInput) {
    const task = this.create(taskInput);
    await this.save();
    setImmediate(() => {
      this.run(task.id).catch((err) => this.logger?.error(`background task error: ${err.message}`));
    });
    return task;
  }
}
