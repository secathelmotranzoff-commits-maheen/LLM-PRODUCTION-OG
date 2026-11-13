import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, runDocumentTask } from '../server/context.js';
import { limits, estimateTokens } from '../server/limits.js';
import { runLocalModel } from '../server/local.js';
import { localWorkers } from '../test-support/local-fixtures.js';
const model = localWorkers[0];
test('page chunks preserve Unicode text, labels, order and byte budget', () => {
  const text = 'കേരളം🙂 evidence '.repeat(100), chunks = chunkPages([{ page: 3, text }], 300, 32);
  assert.ok(chunks.length > 1); assert.ok(chunks.every(c => estimateTokens(c) <= 300));
  assert.equal(chunks.map(c => c.replace(/^\[p\. 3\]\n/, '').replace(/\n\n$/, '')).join(''), text);
  assert.ok(chunks.every(c => c.startsWith('[p. 3]')));
});
test('chunk cap rejects complete input rather than dropping pages', () => {
  assert.throws(() => chunkPages([{ page: 1, text: 'x'.repeat(2000) }], 300, 2), /No pages were omitted/);
});
test('oversized local prompt makes no inference request', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; });
  const result = await runLocalModel(model, 'x'.repeat(100000));
  assert.equal(calls, 0); assert.equal(result.status, 'error'); assert.match(result.error, /budget exceeded/);
});
test('multi-chunk map/reduce sends every source chunk and preserves no-cloud operation', async () => {
  const pages = [{ page: 1, text: 'alpha '.repeat(1000) }, { page: 2, text: 'beta '.repeat(1000) }]; const prompts = [];
  const result = await runDocumentTask(model, { task: 'Summarize', pageBlocks: pages }, async (selected, prompt, options) => {
    prompts.push(prompt); assert.equal(selected.provider, 'ollama'); assert.ok(options.outputTokens <= limits().localOutput);
    return { model: model.id, status: 'success', text: `Finding [p. ${prompts.length === 1 ? 1 : 2}]` };
  });
  assert.equal(result.status, 'success'); assert.ok(result.documentChunks >= 2); assert.ok(prompts.some(p => p.includes('[p. 1]'))); assert.ok(prompts.some(p => p.includes('[p. 2]')));
  assert.equal(prompts.length, result.documentCalls); assert.ok(prompts.at(-1).includes('untrusted source summaries'));
});
test('failed chunk is explicit and never reported as whole-document success', async () => {
  let calls = 0;
  const result = await runDocumentTask(model, { task: 'Summarize', pageBlocks: [{ page: 1, text: 'text '.repeat(2500) }] }, async () => ++calls === 1 ? { model: model.id, status: 'success', text: 'Partial finding [p. 1]' } : { model: model.id, status: 'error', error: 'Runtime unavailable' });
  assert.equal(result.status, 'error'); assert.match(result.text, /INCOMPLETE/); assert.match(result.error, /chunk/);
});
test('invalid context configuration fails validation', t => {
  const previous = process.env.RELAY_LOCAL_CONTEXT; t.after(() => { if (previous === undefined) delete process.env.RELAY_LOCAL_CONTEXT; else process.env.RELAY_LOCAL_CONTEXT = previous; });
  process.env.RELAY_LOCAL_CONTEXT = '99999999'; assert.throws(limits, /RELAY_LOCAL_CONTEXT/);
});
test('cancelled document processing does not start further chunk or synthesis calls', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(runDocumentTask(model, { task: 'Summarize', pageBlocks: [{ page: 1, text: 'data '.repeat(3000) }], signal: controller.signal }, async () => { calls++; controller.abort(); return { model: model.id, status: 'success', text: 'Partial' }; }));
  assert.equal(calls, 1);
});
test('failed document chunks retain their partial output and processing metadata', async () => {
  const result = await runDocumentTask(model, { task: 'Summarize', pageBlocks: [{ page: 1, text: 'evidence '.repeat(1600) }] }, async () => ({ model: model.id, status: 'error', error: 'Output limit reached', text: 'Partial chunk evidence' }));
  assert.equal(result.status, 'error'); assert.match(result.text, /Partial chunk evidence/);
  assert.ok(result.documentChunks > 1); assert.equal(result.documentCalls, 1);
});
test('failed synthesis retains the reason, map evidence and partial synthesis', async () => {
  let calls = 0;
  const result = await runDocumentTask(model, { task: 'Summarize', pageBlocks: [{ page: 1, text: 'evidence '.repeat(1600) }] }, async () => ++calls <= 3 ? { model: model.id, status: 'success', text: 'Map finding' } : { model: model.id, status: 'error', error: 'Output limit', text: 'Partial synthesis' });
  assert.equal(result.status, 'error'); assert.match(result.text, /Partial synthesis/); assert.match(result.text, /Map finding/); assert.equal(result.documentCalls, calls);
});
test('cancellation after a successful map preserves evidence and accounting', async () => {
  const controller = new AbortController();
  try {
    await runDocumentTask(model, { task: 'Review', pageBlocks: [{ page: 1, text: 'evidence '.repeat(1600) }], signal: controller.signal }, async () => { controller.abort(); return { model: model.id, status: 'success', text: 'Recorded map evidence', usage: { prompt_tokens: 20, completion_tokens: 3 } }; });
    assert.fail('Expected cancellation');
  } catch (error) {
    assert.match(error.partialResult.text, /Recorded map evidence/); assert.equal(error.partialResult.documentCalls, 1); assert.equal(error.partialResult.usage.prompt_tokens, 20);
  }
});
test('chunking preserves order across adjacent small and oversized pages', () => {
  const blocks = [{ page: 1, text: 'First' }, { page: 2, text: '🙂x'.repeat(400) }, { page: 3, text: 'Last' }];
  const chunks = chunkPages(blocks, 300, 32), reconstructed = new Map();
  for (const chunk of chunks) {
    assert.ok(estimateTokens(chunk) <= 300);
    for (const match of chunk.matchAll(/\[p\. (\d+)\]\n([\s\S]*?)(?=\[p\. \d+\]\n|$)/g)) reconstructed.set(Number(match[1]), (reconstructed.get(Number(match[1])) || '') + match[2].replace(/\n\n$/, ''));
  }
  assert.deepEqual([...reconstructed].map(([page, text]) => ({ page, text })), blocks);
});
test('document token callbacks identify each local call and reset between chunks', async () => {
  const updates = [];
  const result = await runDocumentTask(model, { task: 'Review', pageBlocks: [{ page: 1, text: 'evidence '.repeat(1600) }], onToken: (text, call) => updates.push({ text, call }) }, async (model, prompt, options) => { await options.onToken(''); await options.onToken('Draft'); return { status: 'success', text: 'Finding' }; });
  assert.equal(result.status, 'success'); assert.equal(updates.length, result.documentCalls * 2); assert.equal(updates.at(-1).call, result.documentCalls);
});
