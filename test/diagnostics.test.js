import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnostics } from '../server/diagnostics.js';
test('diagnostics reports server scope and model availability without collecting identifiers or credentials', async t => {
  t.mock.method(globalThis, 'fetch', async url => ({ ok: true, json: async () => url.endsWith('/api/tags') ? { models: [{ name: 'llama:3b', size: 2000000000 }, { name: 'qwen:3b', size: 2200000000 }] } : { version: 'test-ollama' } }));
  const d = await diagnostics(); assert.match(d.scope, /not necessarily/); assert.equal(d.runtime.modelCount, 2); assert.equal(d.runtime.version, 'test-ollama');
  assert.equal(d.runtime.models[0].sizeBytes, 2000000000); assert.ok(d.system.totalMemoryBytes > 0); assert.ok(d.warnings.some(w => w.includes('GPU')));
  assert.doesNotMatch(JSON.stringify(d), /"hostname"|"username"|"apiKey"|"task"|"cwd"/);
});
test('diagnostics clearly handles a missing runtime', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const d = await diagnostics(); assert.equal(d.runtime.connected, false); assert.equal(d.runtime.version, null); assert.equal(d.runtime.modelCount, 0); assert.ok(d.warnings.some(w => w.includes('Two installed')));
});
