import { localWorkers } from '../test-support/local-fixtures.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { models } from '../server/core.js';
test('task-side selectors and full Brain approval UI flow', async t => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; const $ = id => window.document.getElementById(id); const calls = [];
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async (url, options) => {
    calls.push({ url, options });
    const data = url === '/api/config' ? { models: [...models, ...localWorkers], token: 'test', configured: {}, local: { connected: true, message: 'Ollama connected' } } : url === '/api/brain/plan' ? {
      id: 'plan-1', summary: 'Review the evidence', assignments: ['Extract findings', 'Review limitations'], workers: localWorkers.map(m => m.id), brain: models[0].id, expiresAt: Date.now() + 60000,
    } : url === '/api/brain/execute' ? {
      id: 'run-1', task: 'Summarize', createdAt: new Date().toISOString(), brain: models[0].id,
      results: localWorkers.map(m => ({ model: m.id, status: 'success', text: 'Worker answer', durationMs: 10 })),
      combined: { model: models[0].id, status: 'success', text: '<script>untrusted output</script>', durationMs: 10 },
    } : {};
    return { ok: true, json: async () => data };
  };
  window.eval(script); await new Promise(r => setImmediate(r));
  assert.equal($('model-a').options.length, 2); assert.equal($('model-b').options.length, 2); assert.equal($('model-brain').options.length, 3);
  assert.ok($('model-a').closest('.composer-layout')); assert.ok($('task').closest('.composer-layout'));
  $('brain-mode').click(); assert.equal($('brain-settings').hidden, false);
  $('connections-button').click(); $('key-openai').value = 'brain-key'; $('key-anthropic').value = 'worker-key'; $('save-keys').click();
  $('task').value = 'Summarize'; $('output-mode').value = 'combined';
  await $('task-form').onsubmit(new window.Event('submit', { cancelable: true }));
  assert.equal($('plan-panel').hidden, false); assert.equal($('task').disabled, true);
  assert.equal(calls.filter(c => c.url === '/api/brain/execute').length, 0);
  await $('execute-plan').onclick(); assert.match($('notice').textContent, /approval box/);
  $('approve-plan').checked = true; $('assignment-a').value = 'Edited assignment'; $('assignment-a').dispatchEvent(new window.Event('input'));
  assert.equal($('approve-plan').checked, false);
  $('approve-plan').checked = true; await $('execute-plan').onclick();
  const execution = calls.find(c => c.url === '/api/brain/execute'); const payload = JSON.parse(execution.options.body);
  assert.equal(payload.assignments[0], 'Edited assignment'); assert.equal(payload.approved, true); assert.equal(payload.output, 'combined');
  assert.equal($('plan-panel').hidden, true); assert.equal($('results').hidden, false); assert.equal($('task').disabled, false);
  assert.equal($('result-grid').querySelectorAll('script').length, 0); assert.match($('result-grid').textContent, /<script>untrusted output<\/script>/);
  assert.equal($('result-grid').querySelectorAll('.result-card').length, 3);
});
test('offline runtime leaves two empty local slots and disables execution', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ models, token: 't', local: { connected: false, workers: [], message: 'Start Ollama on this PC' }, configured: {} }) });
  dom.window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
  await new Promise(r => setImmediate(r));
  const $ = id => dom.window.document.getElementById(id);
  assert.equal($('run-button').disabled, true); assert.equal($('model-a').value, ''); assert.match($('model-a').textContent, /No local models/); assert.match($('local-status').textContent, /Start Ollama/);
  assert.equal($('model-brain').options.length, 3);
});
test('refreshing model discovery locks task submission until the refresh finishes', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; let release, calls = 0;
  const gate = new Promise(resolve => release = resolve);
  const data = { models: [...models, ...localWorkers], token: 't', local: { connected: true }, configured: {} };
  window.fetch = async url => { calls++; if (calls === 2) await gate; return { ok: true, json: async () => data }; };
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
  const $ = id => window.document.getElementById(id);
  const refresh = $('refresh-local').onclick(); assert.equal($('run-button').disabled, true); assert.equal($('model-a').disabled, true);
  await $('task-form').onsubmit(new window.Event('submit', { cancelable: true })); assert.equal(calls, 2);
  release(); await refresh; assert.equal($('run-button').disabled, false); assert.equal($('model-a').disabled, false);
});
test('saved runs UI opens durable results and deletes them explicitly', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; const $ = id => window.document.getElementById(id);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.confirm = () => true;
  const saved = { id: 'saved-id', task: 'Stored task', createdAt: new Date().toISOString(), status: 'completed', stage: 'Finished', results: [{ model: localWorkers[0].id, status: 'success', text: 'Stored answer', durationMs: 1 }] };
  let deleted = false;
  window.fetch = async url => ({ ok: true, json: async () => url === '/api/config' ? { models: [...models, ...localWorkers], token: 't', local: { connected: true }, configured: {} } : url === '/api/runs' ? { runs: deleted ? [] : [saved] } : url.endsWith('/delete') ? (deleted = true, { deleted: true }) : saved });
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
  await $('history-button').onclick(); assert.match($('history-list').textContent, /Stored task/);
  await $('history-list').querySelector('.history-item').onclick(); assert.match($('result-grid').textContent, /Stored answer/);
  await $('history-button').onclick(); await $('history-list').querySelector('.quiet').onclick();
  assert.equal(deleted, true); assert.equal($('results').hidden, true); assert.match($('history-list').textContent, /No saved runs/);
});
test('history fallback errors stay visible and partial Worker B is not labeled Worker A', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; const $ = id => window.document.getElementById(id);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.fetch = async url => { if (url === '/api/config') return { ok: true, json: async () => ({ models: [...models, ...localWorkers], token: 't', configured: {}, local: { connected: true } }) }; throw new Error('Offline'); };
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
  await $('history-button').onclick(); assert.match($('history-notice').textContent, /unavailable/);
  window.showResults({ id: 'partial', task: 'Task', createdAt: new Date().toISOString(), status: 'cancelled', results: [{ model: localWorkers[1].id, slot: 1, status: 'success', text: 'B answer', durationMs: 1 }] });
  assert.match($('result-grid').querySelector('.result-title').textContent, /Worker B/); assert.doesNotMatch($('result-grid').querySelector('.result-title').textContent, /Worker A/);
});
test('consumed or uncertain executions clear approval and recover partial results without replay', async t => {
  for (const uncertain of [false, true]) {
    const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
    const { window } = dom; const $ = id => window.document.getElementById(id); let executions = 0;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.fetch = async url => {
      if (url === '/api/brain/execute') { executions++; if (uncertain) throw new Error('Connection lost'); return { ok: false, json: async () => ({ error: 'Cancelled', planConsumed: true, runId: 'saved-partial' }) }; }
      const data = url === '/api/config' ? { models: [...models, ...localWorkers], token: 't', configured: {}, local: { connected: true } } : url === '/api/brain/plan' ? { id: 'pending-plan', brain: models[0].id, workers: localWorkers.map(m => m.id), assignments: ['A', 'B'], summary: 'Plan', expiresAt: Date.now() + 60000 } : { id: 'saved-partial', task: 'Task', createdAt: new Date().toISOString(), status: 'cancelled', results: [{ model: localWorkers[1].id, slot: 1, status: 'success', text: 'Recovered B', durationMs: 1 }] };
      return { ok: true, json: async () => data };
    };
    window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
    $('brain-mode').click(); $('connections-button').click(); $('key-openai').value = 'user-key'; $('save-keys').click(); $('task').value = 'Task';
    await $('task-form').onsubmit(new window.Event('submit', { cancelable: true })); $('approve-plan').checked = true;
    await $('execute-plan').onclick(); assert.equal($('plan-panel').hidden, true); assert.equal($('task').disabled, false);
    assert.match($('notice').textContent, /No automatic retry/); assert.match($('result-grid').textContent, /Recovered B/);
    await $('execute-plan').onclick(); assert.equal(executions, 1);
  }
});
test('diagnostics UI labels server scope, resources and unverified GPU fit', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; const $ = id => window.document.getElementById(id);
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const caps = { localContext: 8192, localOutput: 1024, maxChunks: 12, pdfTimeoutMs: 15000, pdfHeapMb: 128 };
  window.fetch = async url => ({ ok: true, json: async () => url === '/api/config' ? { models: [...models, ...localWorkers], token: 't', local: { connected: true }, configured: {}, limits: caps } : { scope: 'The Relay server, not the browser computer', system: { platform: 'linux', architecture: 'x64', node: '22', cpuThreads: 2, totalMemoryBytes: 8 * 1024 ** 3, freeMemoryBytes: 4 * 1024 ** 3 }, runtime: { connected: true, version: 'test', modelCount: 2, models: [{ name: '<script>model</script>', sizeBytes: 1024 ** 3 }], message: 'Connected' }, limits: caps, warnings: ['GPU fit has not been verified'] } });
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
  await $('diagnostics-button').onclick(); assert.match($('diagnostics-content').textContent, /not the browser/); assert.match($('diagnostics-content').textContent, /GPU fit/);
  assert.equal($('diagnostics-content').querySelectorAll('script').length, 0); assert.match($('context-hint').textContent, /8,192/);
});
test('partial model errors stay visible in result cards and exported Markdown', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; const $ = id => window.document.getElementById(id);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = async () => ({ ok: true, json: async () => ({ models: [...models, ...localWorkers], token: 'test', configured: {}, local: { connected: true } }) });
  let exported = '';
  window.Blob = class { constructor(parts) { exported = parts.join(''); } };
  window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
  window.showResults({ id: 'partial', status: 'failed', task: 'Review', createdAt: new Date().toISOString(), results: [{ model: localWorkers[0].id, status: 'error', error: 'Output limit reached', text: 'Partial evidence', durationMs: 10, documentChunks: 3, documentCalls: 1 }] });
  assert.match($('result-grid').textContent, /Output limit reached/); assert.match($('result-grid').textContent, /Partial evidence/);
  $('export-button').onclick(); assert.match(exported, /Run status: failed/); assert.match(exported, /INCOMPLETE \/ ERROR: Output limit reached/); assert.match(exported, /Partial evidence/);
});
test('live progress renders separate safe worker drafts and ignores polls after stop', async t => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://relay.test', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom; let poll; window.setInterval = callback => { poll = callback; return 1; }; window.clearInterval = () => {};
  window.fetch = async url => ({ ok: true, json: async () => url === '/api/config' ? { models: [...models, ...localWorkers], token: 'test', configured: {}, local: { connected: true } } : { status: 'running', stage: 'Reading', results: [{ slot: 1, model: localWorkers[1].id, status: 'error', live: true, text: '<script>draft</script>', error: 'Incomplete', durationMs: 0 }] } });
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8')); await new Promise(r => setImmediate(r));
  window.startProgress(); await poll(); const live = window.document.getElementById('live-workers');
  assert.match(live.textContent, /Worker B/); assert.match(live.textContent, /Live draft/); assert.equal(live.querySelectorAll('script').length, 0);
  window.stopProgress(); live.textContent = 'Stopped'; await poll(); assert.equal(live.textContent, 'Stopped');
});
