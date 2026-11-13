import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverLocal, ollamaBase } from '../server/local.js';
import { runModel, registerLocalModels, validateRun } from '../server/core.js';
import { localWorkers } from '../test-support/local-fixtures.js';
test('local discovery lists installed models and deduplicates names', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ models: [{ name: 'llama:3b' }, { name: 'llama:3b' }, { name: 'qwen:3b' }, { name: '../bad space' }, { name: 'remote-cloud:latest' }, { name: 'remote:latest', remote_host: 'https://example.com' }] }) }));
  const state = await discoverLocal(); assert.equal(state.connected, true); assert.equal(state.workers.length, 2); assert.equal(state.workers[0].provider, 'ollama');
});
test('missing local runtime is explicit, never fake models', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const state = await discoverLocal(); assert.equal(state.connected, false); assert.deepEqual(state.workers, []);
});
test('local inference requires no key and never sends cloud credentials', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ message: { content: 'Local response' }, eval_count: 8 }) }; });
  const result = await runModel(localWorkers[0], 'Task', 'must-not-send');
  assert.equal(result.status, 'success'); assert.equal(result.local, true); assert.equal(result.usage.completion_tokens, 8);
  assert.equal(sent.options.headers.Authorization, undefined); assert.doesNotMatch(sent.options.body, /must-not-send/); assert.equal(JSON.parse(sent.options.body).stream, false);
});
test('local-only worker validation rejects cloud models', () => {
  registerLocalModels(localWorkers);
  assert.equal(validateRun({ task: 'Run', models: JSON.stringify(localWorkers.map(m => m.id)) }, { localOnly: true }).length, 2);
  assert.throws(() => validateRun({ task: 'Run', models: '["gpt-4.1-mini","gemini-2.5-flash"]' }, { localOnly: true }), /must be installed local/);
});
test('runtime URL blocks remote hosts, credentials and paths', t => {
  const original = process.env.OLLAMA_BASE_URL;
  t.after(() => { if (original === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = original; });
  for (const value of ['http://example.com', 'http://user:pass@localhost', 'http://localhost/private', 'https://localhost']) { process.env.OLLAMA_BASE_URL = value; assert.throws(ollamaBase); }
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434'; assert.equal(ollamaBase(), 'http://127.0.0.1:11434');
});
test('malformed discovery entries do not hide valid local models', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ models: [null, 42, {}, { name: 'llama:3b' }, { name: 'qwen:3b' }] }) }));
  const state = await discoverLocal(); assert.equal(state.connected, true); assert.equal(state.workers.length, 2);
});
test('Ollama output-limit responses retain partial text but are not successful', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ done_reason: 'length', message: { content: 'Unfinished finding' } }) }));
  const result = await runModel(localWorkers[0], 'Task');
  assert.equal(result.status, 'error'); assert.match(result.error, /output limit/i); assert.match(result.text, /Unfinished finding/);
});
