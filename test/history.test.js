import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HistoryStore } from '../server/history.js';
import { createRunManager } from '../server/runs.js';
import { executeBrainPlan } from '../server/brain.js';
import { models, registerLocalModels } from '../server/core.js';
import { localWorkers } from '../test-support/local-fixtures.js';
async function setup(t, limit) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relay-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new HistoryStore(root, limit); await store.init(); return { root, store, runs: createRunManager(store) };
}
test('history survives reopening and excludes keys, raw document context and extra fields', async t => {
  const { root, store, runs } = await setup(t);
  const id = crypto.randomUUID();
  const job = await runs.begin(id, { task: 'Review', keys: { openai: 'secret-api-key' }, pages: 'raw-pdf-context', document: { name: 'test.pdf', pages: 1, characters: 30, content: 'raw-pdf-context' } });
  await job.finish({ results: [{ model: 'local:a', status: 'success', text: 'Answer', usage: { total_tokens: 2, key: 'secret-api-key' } }] });
  const fresh = new HistoryStore(root); await fresh.init();
  assert.equal((await fresh.get(id)).results[0].text, 'Answer');
  const text = await readFile(path.join(root, `${id}.json`), 'utf8'); assert.doesNotMatch(text, /secret-api-key|raw-pdf-context|"keys"/);
  assert.equal((await fresh.list()).length, 1);
  await fresh.remove(id); assert.equal(await fresh.get(id), null); assert.equal((await fresh.list()).length, 0);
  assert.deepEqual(await readdir(root), []);
});
test('restart marks unfinished runs interrupted while preserving partial outputs', async t => {
  const { root, runs } = await setup(t); const id = crypto.randomUUID();
  const job = await runs.begin(id, { task: 'Long task' });
  await job.update('Worker A done', { results: [{ model: 'a', status: 'success', text: 'Partial' }] });
  const fresh = new HistoryStore(root); await fresh.init(); const recovered = await fresh.get(id);
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.results[0].text, 'Partial');
});
test('retention, path validation and duplicate IDs are enforced', async t => {
  const { store, runs } = await setup(t, 2);
  for (let i = 0; i < 3; i++) await store.save({ id: crypto.randomUUID(), task: 'Task', status: 'completed', createdAt: `2026-01-0${i + 1}` });
  assert.equal((await store.list()).length, 2);
  await assert.rejects(store.get('../secret')); await assert.rejects(runs.begin('bad', {}));
  const id = crypto.randomUUID(); const results = await Promise.allSettled([runs.begin(id, { task: 'A' }), runs.begin(id, { task: 'B' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('cancel aborts the signal, retains partial results and prevents Brain synthesis', async t => {
  const { runs, store } = await setup(t); const id = crypto.randomUUID();
  const job = await runs.begin(id, { task: 'Summarize' }); registerLocalModels(localWorkers);
  let calls = 0;
  const execution = executeBrainPlan({ plan: { task: 'Summarize', brain: models[0].id, workers: localWorkers.map(m => m.id) }, assignments: ['A', 'B'], output: 'combined', keys: { openai: 'user-key' }, signal: job.controller.signal, onProgress: (stage, fields) => job.update(stage, fields) }, async model => {
    calls++; if (calls === 1) return { model: model.id, status: 'success', text: 'Partial answer' };
    return new Promise(resolve => job.controller.signal.addEventListener('abort', () => resolve({ model: model.id, status: 'error', error: 'Cancelled' }), { once: true }));
  });
  await runs.cancel(id); await assert.rejects(execution); await job.finish({ status: 'failed' });
  assert.equal(calls, 2); assert.equal((await store.get(id)).status, 'cancelled'); assert.ok((await store.get(id)).results.some(r => r.text === 'Partial answer')); assert.equal(await runs.cancel(id), false);
});
test('storage failure is visible without blocking model results', async t => {
  const { runs, store } = await setup(t); store.save = async () => { throw new Error('Disk full'); };
  const job = await runs.begin(crypto.randomUUID(), { task: 'Task' });
  const result = await job.finish({ results: [{ model: 'a', status: 'success', text: 'Result' }] });
  assert.match(result.storageWarning, /could not be saved/); assert.equal(result.results[0].text, 'Result');
});
test('malformed history records do not break listing healthy saved runs', async t => {
  const { root, store, runs } = await setup(t); const good = await runs.begin(crypto.randomUUID(), { task: 'Healthy' }); await good.finish();
  const { writeFile } = await import('node:fs/promises');
  const id = crypto.randomUUID(); await writeFile(path.join(root, `${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), task: 'Broken', results: {} }));
  const listed = await store.list(); assert.equal(listed.length, 1); assert.equal(listed[0].task, 'Healthy');
});
test('terminal run state cannot be changed by late updates or a second finish', async t => {
  const { store, runs } = await setup(t); const id = crypto.randomUUID(); const job = await runs.begin(id, { task: 'Task' });
  await job.finish({ stage: 'Finished', status: 'completed' });
  await job.update('Late worker', { status: 'running' }); await job.finish({ status: 'failed', error: 'Late failure' });
  assert.equal((await store.get(id)).status, 'completed'); assert.equal((await store.get(id)).stage, 'Finished');
});
test('history rejects oversized, mismatched and symlink records without hiding healthy history', async t => {
  const { root, store, runs } = await setup(t); const good = await runs.begin(crypto.randomUUID(), { task: 'Good' }); await good.finish();
  const { writeFile, symlink } = await import('node:fs/promises');
  const large = crypto.randomUUID(), wrong = crypto.randomUUID(), linked = crypto.randomUUID();
  await writeFile(path.join(root, `${large}.json`), 'x'.repeat(2 * 1024 * 1024 + 1));
  await writeFile(path.join(root, `${wrong}.json`), JSON.stringify({ id: crypto.randomUUID(), task: 'Mismatch', createdAt: new Date().toISOString(), status: 'completed' }));
  await symlink(path.join(root, `${good.run.id}.json`), path.join(root, `${linked}.json`));
  assert.equal((await store.list()).length, 1); assert.equal(store.skipped, 2);
  await assert.rejects(store.get(large)); await assert.rejects(store.get(wrong)); await assert.rejects(store.get(linked));
});
test('restart expires plans whose approval context was not restored', async t => {
  const { root, runs } = await setup(t); const job = await runs.begin(crypto.randomUUID(), { task: 'Plan' });
  await job.finish({ status: 'plan_ready', plan: { summary: 'Plan', assignments: ['A', 'B'] } });
  const fresh = new HistoryStore(root); await fresh.init(); assert.equal((await fresh.get(job.run.id)).status, 'plan_expired');
});
test('history temp writes do not follow predictable leftover symlinks', async t => {
  const { root, runs } = await setup(t); const { writeFile, symlink } = await import('node:fs/promises');
  const id = crypto.randomUUID(), target = path.join(root, 'untouched.txt'); await writeFile(target, 'untouched');
  await symlink(target, path.join(root, `${id}.json.tmp`));
  const job = await runs.begin(id, { task: 'Task' }); await job.finish();
  assert.equal(await readFile(target, 'utf8'), 'untouched');
});
test('workflow classification does not call incomplete reports completed', async () => {
  const { completionStatus } = await import('../server/runs.js');
  const ok = { status: 'success' }, bad = { status: 'error' };
  assert.equal(completionStatus([ok, ok]), 'completed'); assert.equal(completionStatus([ok, bad]), 'partial');
  assert.equal(completionStatus([ok, ok], bad), 'partial'); assert.equal(completionStatus([bad, bad]), 'failed');
});
test('live checkpoints retain slot identity, throttle disk writes, survive restart and ignore late tokens', async t => {
  const { root, store, runs } = await setup(t); const id = crypto.randomUUID();
  let saves = 0; const original = store.save.bind(store); store.save = run => { saves++; return original(run); };
  const job = await runs.begin(id, { task: 'Streaming' });
  await job.stream(1, 'local:b', 'B draft', 2);
  const afterFirst = saves;
  await job.stream(1, 'local:b', 'B draft expanded', 2);
  assert.equal(saves, afterFirst); assert.equal((await runs.get(id)).results[0].text, 'B draft expanded');
  await job.stream(0, 'local:a', 'A draft', 1);
  assert.deepEqual(job.run.results.map(r => r.slot), [0, 1]);
  const fresh = new HistoryStore(root); await fresh.init(); const recovered = await fresh.get(id);
  assert.equal(recovered.status, 'interrupted'); assert.ok(recovered.results.every(r => r.status === 'error')); assert.match(recovered.results[1].text, /B draft/);
  await job.finish({ status: 'completed', results: [{ slot: 0, model: 'local:a', status: 'success', text: 'Final' }] });
  await job.stream(0, 'local:a', 'Late data'); assert.equal((await runs.get(id)).results[0].text, 'Final');
});
test('cancelled runs reject late live updates without losing saved drafts', async t => {
  const { runs } = await setup(t); const id = crypto.randomUUID(), job = await runs.begin(id, { task: 'Cancel stream' });
  await job.stream(0, 'local:a', 'Draft'); await runs.cancel(id); await job.stream(0, 'local:a', 'Late');
  const final = await job.finish(); assert.equal(final.status, 'cancelled'); assert.equal(final.results[0].text, 'Draft');
});
