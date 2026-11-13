import { mkdir, readdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const maxBytes = 2 * 1024 * 1024;
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const pick = (value, names) => Object.fromEntries(names.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
function result(value) {
  if (!value || typeof value.model !== 'string' || !['success', 'error'].includes(value.status)) throw new Error('Invalid saved model result.');
  for (const key of ['text', 'error']) if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error('Invalid saved result text.');
  const clean = pick(value, ['model', 'status', 'text', 'error', 'durationMs', 'local', 'documentChunks', 'documentCalls', 'live']);
  if (value.slot === 0 || value.slot === 1) clean.slot = value.slot;
  if (value.usage) clean.usage = Object.fromEntries(Object.entries(pick(value.usage, ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens', 'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'])).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0));
  return clean;
}
export function historyRecord(run) {
  if (!run || !validId(run.id) || typeof run.task !== 'string' || typeof run.createdAt !== 'string' || !Number.isFinite(Date.parse(run.createdAt)) || typeof run.status !== 'string') throw new Error('Invalid saved run.');
  if (run.results !== undefined && (!Array.isArray(run.results) || run.results.length > 2)) throw new Error('Invalid saved results.');
  for (const key of ['updatedAt', 'stage', 'output', 'brain', 'error']) if (run[key] !== undefined && typeof run[key] !== 'string') throw new Error('Invalid saved run metadata.');
  const record = pick(run, ['id', 'createdAt', 'updatedAt', 'task', 'status', 'stage', 'output', 'brain', 'error']);
  record.document = null;
  if (run.document) {
    if (typeof run.document.name !== 'string' || !Number.isFinite(run.document.pages) || !Number.isFinite(run.document.characters)) throw new Error('Invalid saved document metadata.');
    record.document = pick(run.document, ['name', 'pages', 'characters']);
  }
  record.results = (run.results || []).map(result);
  record.combined = run.combined ? result(run.combined) : null;
  if (run.plan) {
    if (typeof run.plan.summary !== 'string' || (run.plan.assignments !== undefined && (!Array.isArray(run.plan.assignments) || run.plan.assignments.length !== 2 || run.plan.assignments.some(v => typeof v !== 'string')))) throw new Error('Invalid saved plan.');
    record.plan = pick(run.plan, ['summary', 'assignments']);
  }
  return record;
}
export class HistoryStore {
  constructor(root, limit = 100) { this.root = path.resolve(root); this.limit = limit; this.queue = Promise.resolve(); }
  serial(work) { const job = this.queue.then(work); this.queue = job.catch(() => {}); return job; }
  filename(id) { if (!validId(id)) throw new Error('Invalid run ID.'); return path.join(this.root, `${id}.json`); }
  async readRecord(id) {
    const file = this.filename(id);
    if ((await lstat(file)).isSymbolicLink()) throw new Error('History symlinks are not supported.');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw new Error('Invalid history file or size.');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!part.bytesRead) break;
        bytesRead += part.bytesRead;
      }
      if (bytesRead !== stat.size || bytesRead > maxBytes) throw new Error('History file changed while reading.');
      const record = historyRecord(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
      if (record.id !== id) throw new Error('Saved run ID does not match its filename.');
      return record;
    } finally { await handle.close(); }
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const run of await this.list()) {
      const interrupted = ['running', 'cancelling'].includes(run.status), expired = run.status === 'plan_ready';
      if (interrupted || expired) {
        const full = await this.get(run.id); if (!full) continue;
        await this.save({ ...full, status: expired ? 'plan_expired' : 'interrupted', stage: expired ? 'Approval context was not restored. Generate a new plan.' : 'Interrupted by server restart. Not retried.', updatedAt: new Date().toISOString() });
      }
    }
  }
  async rawList() {
    const entries = []; let skipped = 0;
    // Sequential bounded reads: one malformed record must not break the library or startup.
    for (const file of await readdir(this.root, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.json') || !validId(file.name.slice(0, -5))) continue;
      try { entries.push(await this.readRecord(file.name.slice(0, -5))); } catch { skipped++; /* Leave damaged files for manual recovery. */ }
    }
    this.skipped = skipped;
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async list() { await this.queue; return (await this.rawList()).map(run => ({ ...pick(run, ['id', 'createdAt', 'updatedAt', 'task', 'status', 'stage', 'brain', 'output', 'document']), successes: run.results.filter(r => r.status === 'success').length })); }
  async get(id) { await this.queue; try { return await this.readRecord(id); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  save(run) {
    const clean = historyRecord(run);
    return this.serial(async () => {
      const file = this.filename(clean.id), temporary = `${file}.${randomUUID()}.tmp`;
      const text = JSON.stringify(clean);
      if (Buffer.byteLength(text) > maxBytes) throw new Error('Run exceeds history size limit.');
      let handle;
      try {
        handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(text, 'utf8'); await handle.close(); handle = null;
        await rename(temporary, file);
      } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
      const all = await this.rawList();
      for (const old of all.slice(this.limit)) if (!['running', 'cancelling'].includes(old.status)) await unlink(this.filename(old.id)).catch(() => {});
      return clean;
    });
  }
  remove(id) { return this.serial(async () => { try { await unlink(this.filename(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }); }
}
export { validId };
