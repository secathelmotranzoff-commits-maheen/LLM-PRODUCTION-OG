import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRun, makePrompt, runModel, models } from '../server/core.js';
test('accepts two supported models', () => assert.equal(validateRun({ task: 'Review', models: JSON.stringify(models.slice(0, 2).map(m => m.id)) }).length, 2));
test('rejects empty tasks, duplicates, malformed and unknown models', () => {
  for (const body of [{ task: '', models: '[]' }, { task: 'a', models: '["x","y"]' }, { task: 'a', models: 'bad' }, { task: 'a', models: JSON.stringify([models[0].id, models[0].id]) }, { task: 'x'.repeat(12001), models: '[]' }]) assert.throws(() => validateRun(body));
});
test('prompt separates untrusted documents and instructs page references', () => {
  const prompt = makePrompt('Summarize', '[p. 1] Example');
  assert.match(prompt, /untrusted source material/); assert.match(prompt, /\[p\. 1\]/); assert.match(makePrompt('Hi', ''), /No document supplied/);
});
test('missing key returns an explicit error, never a fake response', async () => {
  const result = await runModel(models[0], 'Hello', ''); assert.equal(result.status, 'error'); assert.equal(result.text, undefined);
});
test('provider response is normalized', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Answer' } }], usage: { total_tokens: 12 } }) }));
  const result = await runModel(models[0], 'Hello', 'test-key'); assert.equal(result.text, 'Answer'); assert.equal(result.usage.total_tokens, 12);
});
test('provider errors do not expose credentials or raw response bodies', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401 }));
  const result = await runModel(models[0], 'Hello', 'secret'); assert.equal(result.status, 'error'); assert.doesNotMatch(result.error, /secret/); assert.match(result.error, /rejected/);
});
test('one provider failure does not discard another result', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.includes('openai') ? { ok: false, status: 429 } : { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Other answer' }] }) });
  const results = await Promise.all(models.slice(0, 2).map(m => runModel(m, 'Hi', 'key'))); assert.equal(results[0].status, 'error'); assert.equal(results[1].text, 'Other answer');
});
test('Brain input exceeding configured context is rejected before a cloud request', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; });
  const result = await runModel(models[0], 'x'.repeat(130000), 'user-key');
  assert.equal(result.status, 'error'); assert.match(result.error, /context budget exceeded/); assert.equal(calls, 0);
});
test('all cloud output-limit signals preserve partial text without claiming completion', async t => {
  const responses = [
    { choices: [{ finish_reason: 'length', message: { content: 'Partial report' } }] },
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Partial report' }] },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Partial report' }] } }] },
  ];
  let index = 0; t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => responses[index++] }));
  for (const model of models.filter(m => m.provider !== 'ollama')) {
    const result = await runModel(model, 'Task', 'user-key');
    assert.equal(result.status, 'error'); assert.match(result.error, /output limit/i); assert.equal(result.text, 'Partial report');
  }
});
