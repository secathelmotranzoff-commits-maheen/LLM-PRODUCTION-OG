import { localWorkers } from '../test-support/local-fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import { registerBrainRoutes } from '../server/brain-routes.js';
import { models, registerLocalModels } from '../server/core.js';
import { createBrainPlan, executeBrainPlan, parsePlan, requireBrainKey } from '../server/brain.js';
registerLocalModels(localWorkers);
const keys = { openai: 'user-brain-key', anthropic: 'user-worker-key' };
const plan = { task: 'Summarize', pages: '[p. 1] Evidence', brain: models[0].id, workers: localWorkers.map(m => m.id) };
const assignments = ['Extract findings', 'Evaluate limitations'];
const success = text => ({ status: 'success', text, durationMs: 1, usage: { total_tokens: 5 } });
test('Brain BYOK cannot use operator environment keys', async t => {
  const original = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'operator-key';
  t.after(() => { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; });
  assert.throws(() => requireBrainKey(models[0], {}), /own OpenAI API key/);
  let called = false;
  await assert.rejects(createBrainPlan({ ...plan, brain: models[0], workers: localWorkers, keys: {} }, async () => { called = true; }), /own OpenAI/);
  assert.equal(called, false);
});
test('validates structured plans and rejects malformed or empty assignments', () => {
  assert.deepEqual(parsePlan('```json\n' + JSON.stringify({ summary: 'Plan', assignments }) + '\n```').assignments, assignments);
  for (const text of ['not json', '{}', '{"summary":"Plan","assignments":["", "x"]}']) assert.throws(() => parsePlan(text));
});
test('separate mode executes exactly two approved assignments, no synthesis', async () => {
  const calls = [];
  const result = await executeBrainPlan({ plan, assignments, keys, output: 'separate' }, async (model, prompt, key) => { calls.push({ model, prompt, key }); return { model: model.id, ...success('Worker answer') }; });
  assert.equal(calls.length, 2); assert.equal(result.combined, null); assert.match(calls[0].prompt, /Extract findings/); assert.match(calls[1].prompt, /Evaluate limitations/);
});
test('combined mode uses session Brain key and retains failed worker evidence', async () => {
  const calls = [];
  const result = await executeBrainPlan({ plan, assignments, keys, output: 'combined' }, async (model, prompt, key) => {
    calls.push({ model, prompt, key });
    return calls.length === 2 ? { model: model.id, status: 'error', error: 'Provider failed', durationMs: 1 } : { model: model.id, ...success('Report') };
  });
  assert.equal(calls.length, 3); assert.equal(calls[2].key, 'user-brain-key'); assert.match(calls[2].prompt, /Provider failed/); assert.equal(result.combined.text, 'Report');
});
test('both failed workers skip synthesis and report an explicit error', async () => {
  let calls = 0;
  const result = await executeBrainPlan({ plan, assignments, keys, output: 'combined' }, async model => { calls++; return { model: model.id, status: 'error', error: 'No key', durationMs: 0 }; });
  assert.equal(calls, 2); assert.equal(result.combined.status, 'error');
});
test('HTTP approval lifecycle: no early workers, edited assignments, single-use execution, discard', async t => {
  const app = express(); app.use(express.json()); const calls = [];
  registerBrainRoutes(app, { upload: multer(), runGuard: (req, res, next) => next(), invoke: async (model, prompt, key) => {
    calls.push({ model: model.id, prompt, key });
    return { model: model.id, ...success(prompt.includes('planning Brain') ? JSON.stringify({ summary: 'Split research and review', assignments }) : 'Final answer') };
  } });
  app.use((error, req, res, next) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const create = async () => {
    const form = new FormData(); form.append('task', plan.task); form.append('brain', plan.brain); form.append('models', JSON.stringify(plan.workers)); form.append('keys', JSON.stringify(keys)); form.append('output', 'combined');
    const res = await fetch(base + '/api/brain/plan', { method: 'POST', body: form }); assert.equal(res.status, 200); return res.json();
  };
  const generated = await create(); assert.equal(calls.length, 1); assert.equal(generated.pages, undefined); assert.equal(generated.keys, undefined);
  const body = { planId: generated.id, keys, output: 'combined', assignments: ['Edited worker task', assignments[1]] };
  assert.equal((await post('/api/brain/execute', body)).status, 400); assert.equal(calls.length, 1);
  assert.equal((await post('/api/brain/execute', { ...body, approved: true, output: 'separate' })).status, 400); assert.equal(calls.length, 1);
  const executed = await post('/api/brain/execute', { ...body, approved: true }); assert.equal(executed.status, 200);
  const result = await executed.json(); assert.equal(result.results.length, 2); assert.equal(result.combined.text, 'Final answer'); assert.match(calls[1].prompt, /Edited worker task/);
  assert.equal((await post('/api/brain/execute', { ...body, approved: true })).status, 400); assert.equal(calls.length, 4);
  const discarded = await create(); assert.equal((await post('/api/brain/discard', { planId: discarded.id })).status, 200);
  assert.equal((await post('/api/brain/execute', { ...body, planId: discarded.id, approved: true })).status, 400);
});
test('concurrent planning reservations enforce the 20-plan cap before extra Brain calls', async t => {
  const app = express(); let calls = 0, ready;
  const allStarted = new Promise(resolve => ready = resolve); let release;
  const gate = new Promise(resolve => release = resolve);
  registerBrainRoutes(app, { upload: multer(), runGuard: (req, res, next) => next(), invoke: async model => {
    calls++; if (calls === 20) ready(); await gate;
    return { model: model.id, ...success(JSON.stringify({ summary: 'Plan', assignments })) };
  } });
  app.use((error, req, res, next) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await onceListening(server);
  t.after(async () => { release(); app.emit('relay:close'); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/brain/plan`;
  const create = () => {
    const form = new FormData(); form.append('task', plan.task); form.append('brain', plan.brain); form.append('models', JSON.stringify(plan.workers)); form.append('keys', JSON.stringify(keys));
    return fetch(url, { method: 'POST', body: form });
  };
  const pending = Array.from({ length: 20 }, create);
  await allStarted;
  const excess = await create(); assert.equal(excess.status, 400); assert.match((await excess.json()).error, /Plan limit/); assert.equal(calls, 20);
  release(); const responses = await Promise.all(pending); assert.ok(responses.every(r => r.status === 200));
});
function onceListening(server) { return new Promise(resolve => server.once('listening', resolve)); }
test('partial worker progress retains original slot identity when B finishes first', async () => {
  let releaseA; const gate = new Promise(resolve => releaseA = resolve); const snapshots = [];
  await executeBrainPlan({ plan, assignments, keys, output: 'separate', onProgress: async (stage, fields) => { snapshots.push(fields.results); if (fields.results.length === 1) releaseA(); } }, async model => {
    if (model.id === localWorkers[0].id) await gate;
    return { model: model.id, ...success(model.name) };
  });
  assert.equal(snapshots[0][0].slot, 1); assert.equal(snapshots[0][0].model, localWorkers[1].id);
  assert.deepEqual(snapshots[1].map(r => r.slot), [0, 1]);
});
test('run registration rejection preserves the approved plan for corrected submission', async t => {
  const app = express(); app.use(express.json()); let calls = 0, attempts = 0;
  const fakeRuns = { begin: async id => {
    if (++attempts === 2) throw new Error('Run ID already used.');
    return { run: { id }, controller: new AbortController(), update: async () => {}, finish: async fields => ({ id, createdAt: new Date().toISOString(), ...fields }) };
  } };
  registerBrainRoutes(app, { upload: multer(), runGuard: (req, res, next) => next(), runs: fakeRuns, invoke: async model => {
    calls++; return { model: model.id, ...success(calls === 1 ? JSON.stringify({ summary: 'Plan', assignments }) : 'Answer') };
  } });
  app.use((error, req, res, next) => res.status(400).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await onceListening(server);
  t.after(async () => { app.emit('relay:close'); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = new FormData(); form.append('task', plan.task); form.append('brain', plan.brain); form.append('models', JSON.stringify(plan.workers)); form.append('keys', JSON.stringify(keys));
  const generated = await (await fetch(base + '/api/brain/plan', { method: 'POST', body: form })).json();
  const execute = () => fetch(base + '/api/brain/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: generated.id, approved: true, assignments, keys, output: 'separate' }) });
  const rejected = await execute(); assert.equal(rejected.status, 400); assert.equal((await rejected.json()).planConsumed, false); assert.equal(calls, 1);
  const accepted = await execute(); assert.equal(accepted.status, 200); assert.equal(calls, 3);
});
test('Brain execution forwards cancellation to local and cloud invocations', async () => {
  const controller = new AbortController(), seen = [];
  await executeBrainPlan({ plan, assignments, keys, output: 'combined', signal: controller.signal }, async (model, prompt, key, options) => { seen.push(options?.signal); return { model: model.id, ...success('Report') }; });
  assert.equal(seen.length, 3); assert.ok(seen.every(signal => signal === controller.signal));
});
