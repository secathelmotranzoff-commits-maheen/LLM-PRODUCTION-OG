import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOllamaStream } from '../server/ollama-stream.js';
import { runLocalModel } from '../server/local.js';
import { localWorkers } from '../test-support/local-fixtures.js';
const encoder = new TextEncoder();
function response(parts) { return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(typeof p === 'string' ? encoder.encode(p) : p); c.close(); } })); }
const record = (text, done = false, extra = {}) => JSON.stringify({ message: { content: text }, done, ...extra }) + '\n';
test('NDJSON decoder accepts split UTF-8, multiple records and final record without newline', async () => {
  const bytes = encoder.encode(record('🙂 മലയാളം') + record(' final', true).trimEnd()), updates = [];
  const data = await readOllamaStream(response([...bytes].map(b => Uint8Array.of(b))), { onToken: text => updates.push(text) });
  assert.equal(data.message.content, '🙂 മലയാളം final'); assert.deepEqual(updates, ['🙂 മലയാളം', '🙂 മലയാളം final']);
});
test('stream EOF and malformed records fail while preserving partial output', async () => {
  for (const tail of ['', '{bad json}\n']) {
    await assert.rejects(readOllamaStream(response([record('Draft'), tail])), error => { assert.equal(error.partialText, 'Draft'); return /completion|malformed/.test(error.message); });
  }
});
test('stream runtime errors never expose raw server secrets', async () => {
  await assert.rejects(readOllamaStream(response([record('Draft'), '{"error":"secret-key"}\n'])), error => { assert.doesNotMatch(error.message, /secret-key/); return true; });
});
test('oversized stream output fails explicitly with bounded partial text', async () => {
  await assert.rejects(readOllamaStream(response([record('x'.repeat(50))]), { maxBytes: 20 }), /output safety limit/);
});
test('cancellation interrupts a stalled reader and preserves prior tokens', async () => {
  const controller = new AbortController(); let cancelled = false;
  const res = new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(record('Draft'))); }, cancel() { cancelled = true; } }));
  await assert.rejects(readOllamaStream(res, { signal: controller.signal, onToken: () => controller.abort() }), error => { assert.equal(error.partialText, 'Draft'); return error.name === 'AbortError'; });
  assert.equal(cancelled, true);
});
test('local streaming uses real NDJSON and output-limit metadata stays incomplete', async t => {
  let sent; const updates = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent = JSON.parse(options.body); return response([record('Partial'), record(' text', true, { done_reason: 'length', eval_count: 4 })]); });
  const result = await runLocalModel(localWorkers[0], 'Task', { onToken: text => updates.push(text) });
  assert.equal(sent.stream, true); assert.equal(result.status, 'error'); assert.equal(result.text, 'Partial text'); assert.match(result.error, /output limit/); assert.equal(result.usage.completion_tokens, 4); assert.ok(updates.length > 1);
});
test('local broken streams return partial text without retries', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return response([record('Unfinished')]); });
  const result = await runLocalModel(localWorkers[0], 'Task', { onToken() {} });
  assert.equal(result.status, 'error'); assert.equal(result.text, 'Unfinished'); assert.match(result.error, /before completion/); assert.equal(calls, 1);
});
