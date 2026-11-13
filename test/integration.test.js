import { createServer, request } from 'node:http';
import { localWorkers } from '../test-support/local-fixtures.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let child, root, token, ollama, waitingForInference, streamReady, releaseStream;
const base = 'http://127.0.0.1:3107';
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
  ollama = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: localWorkers.map(m => ({ name: m.apiModel })) }));
    if (req.url === '/api/chat') { let body = ''; for await (const chunk of req) body += chunk; const data = JSON.parse(body); if (data.messages?.[0]?.content.includes('cancel-test')) { waitingForInference?.(); await new Promise(resolve => setTimeout(resolve, 500)); } if (data.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ message: { content: 'Local answer ' }, done: false }) + '\n');
      if (data.messages[0].content.includes('stream-check')) { streamReady?.(); await new Promise(resolve => { releaseStream.push(resolve); }); }
      return res.end(JSON.stringify({ message: { content: `from ${data.model}` }, done: true, done_reason: 'stop', eval_count: 10 }) + '\n');
    }
    return res.end(JSON.stringify({ message: { content: `Local answer from ${data.model}` }, eval_count: 10 })); }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3107', RELAY_LOCAL: '1', OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, RELAY_WORKSPACE: root, RELAY_DATA_DIR: path.join(root, 'data'), OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); let output = ''; child.stdout.on('data', chunk => { output += chunk; if (output.includes('Relay workspace listening')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); });
  token = (await (await fetch(`${base}/api/config`)).json()).token;
});
after(async () => { if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } await new Promise(resolve => ollama.close(resolve)); await rm(root, { recursive: true, force: true }); });
async function tool(name, args = {}, approved = false) {
  const res = await fetch(`${base}/api/mcp/call`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Token': token }, body: JSON.stringify({ name, arguments: args, approved }) });
  return { status: res.status, data: await res.json() };
}
test('homepage served and cross-site mutation blocked', async () => {
  assert.equal((await fetch(base)).status, 200);
  const hostStatus = await new Promise((resolve, reject) => { const req = request(base, { headers: { Host: 'attacker.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${base}/api/mcp/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
test('real MCP handshake discovers the three allowed tools', async () => {
  const data = await (await fetch(`${base}/api/mcp/tools`)).json(); assert.deepEqual(data.tools.map(t => t.name).sort(), ['create_file', 'list_files', 'read_file']);
});
test('write requires approval; approved create/read/list round trip works', async () => {
  assert.equal((await tool('create_file', { filename: 'notes.txt', content: 'hello' })).status, 403);
  assert.equal((await tool('create_file', { filename: 'notes.txt', content: 'hello' }, true)).data.isError, undefined);
  assert.equal((await tool('read_file', { filename: 'notes.txt' })).data.content[0].text, 'hello');
  assert.match((await tool('list_files')).data.content[0].text, /notes.txt/);
  assert.equal((await tool('create_file', { filename: 'notes.txt', content: 'overwrite' }, true)).data.isError, true);
});
test('blocks traversal, symlinks, oversized reads and arbitrary execution', async () => {
  assert.equal((await tool('read_file', { filename: '../package.json' })).data.isError, true);
  await symlink('/etc/passwd', path.join(root, 'escape.txt'));
  assert.equal((await tool('read_file', { filename: 'escape.txt' })).data.isError, true);
  await writeFile(path.join(root, 'large.txt'), 'x'.repeat(32001));
  assert.equal((await tool('read_file', { filename: 'large.txt' })).data.isError, true);
  assert.equal((await tool('exec', { command: 'ls' }, true)).status, 400);
});
test('invalid requests release capacity; local workers execute without API keys', async () => {
  for (let i = 0; i < 5; i++) {
    const form = new FormData(); form.append('task', 'Hi'); form.append('models', '[]');
    assert.equal((await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'X-Relay-Token': token }, body: form })).status, 400);
  }
  const form = new FormData(); form.append('task', 'Hi'); form.append('models', JSON.stringify(localWorkers.map(m => m.id)));
  const res = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'X-Relay-Token': token }, body: form });
  assert.equal(res.status, 200); assert.ok((await res.json()).results.every(r => r.status === 'success' && r.local));
});
async function makePdf(text) {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ compress: false });
  const chunks = [];
  const done = new Promise(resolve => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  doc.text(text); doc.end(); return done;
}
test('extracts an actual PDF and rejects fake PDF uploads', async () => {
  for (const [text, expected] of [[await makePdf('A real PDF test document.'), 200], ['not a pdf', 400]]) {
    const form = new FormData(); form.append('task', 'Summarize'); form.append('models', JSON.stringify(localWorkers.map(m => m.id))); form.append('pdf', new Blob([text], { type: 'application/pdf' }), 'test.pdf');
    const res = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'X-Relay-Token': token }, body: form }); const data = await res.json();
    assert.equal(res.status, expected, JSON.stringify(data)); if (expected === 200) assert.equal(data.document.pages, 1);
  }
});
test('production API refuses cloud workers', async () => {
  const form = new FormData(); form.append('task', 'Hi'); form.append('models', '["gpt-4.1-mini","gemini-2.5-flash"]');
  const res = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'X-Relay-Token': token }, body: form });
  assert.equal(res.status, 400); assert.match((await res.json()).error, /must be installed local/);
});
test('malformed JSON is sanitized and oversized JSON returns 413', async () => {
  const headers = { 'Content-Type': 'application/json', 'X-Relay-Token': token };
  const malformed = await fetch(`${base}/api/brain/execute`, { method: 'POST', headers, body: 'audit-secret-key-not-json' });
  assert.equal(malformed.status, 400); assert.doesNotMatch(await malformed.text(), /audit-secret/);
  const oversized = await fetch(`${base}/api/brain/execute`, { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(50000) }) });
  assert.equal(oversized.status, 413);
});
test('HTTP progress, cancellation, saved retrieval and deletion work end to end', async () => {
  const id = crypto.randomUUID();
  const observed = new Promise(resolve => waitingForInference = resolve);
  const form = new FormData(); form.append('task', 'cancel-test'); form.append('models', JSON.stringify(localWorkers.map(m => m.id)));
  const headers = { 'X-Relay-Token': token };
  const running = fetch(`${base}/api/compare`, { method: 'POST', headers: { ...headers, 'X-Relay-Run': id }, body: form });
  await observed;
  const progress = await (await fetch(`${base}/api/runs/${id}`)).json(); assert.equal(progress.status, 'running'); assert.match(progress.stage, /Running local/);
  assert.equal((await fetch(`${base}/api/runs/${id}/delete`, { method: 'POST', headers })).status, 409);
  assert.equal((await fetch(`${base}/api/runs/${id}/cancel`, { method: 'POST', headers })).status, 200);
  const settled = await (await running).json(); assert.equal(settled.status, 'cancelled');
  const saved = await (await fetch(`${base}/api/runs/${id}`)).json(); assert.equal(saved.status, 'cancelled');
  assert.ok((await (await fetch(`${base}/api/runs`)).json()).runs.some(run => run.id === id));
  assert.equal((await fetch(`${base}/api/runs/${id}/delete`, { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(`${base}/api/runs/${id}`)).status, 404);
  waitingForInference = null;
});
test('diagnostics endpoint reports server resources and configured safety limits', async () => {
  const response = await fetch(`${base}/api/diagnostics`); assert.equal(response.status, 200); const data = await response.json();
  assert.match(data.scope, /Relay server/); assert.equal(data.runtime.modelCount, 2); assert.equal(data.limits.localContext, 8192); assert.equal(data.limits.pdfHeapMb, 128);
});
test('large PDF runs through real extraction and multi-chunk local adapters', async () => {
  const text = 'Evidence shows the project needs careful review of assumptions. '.repeat(180);
  const form = new FormData(); form.append('task', 'Summarize the evidence and cite pages'); form.append('models', JSON.stringify(localWorkers.map(m => m.id)));
  form.append('pdf', new Blob([await makePdf(text)], { type: 'application/pdf' }), 'long.pdf');
  const res = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'X-Relay-Token': token }, body: form });
  const result = await res.json(); assert.equal(res.status, 200, JSON.stringify(result)); assert.equal(result.status, 'completed');
  assert.ok(result.results.every(r => r.documentChunks > 1 && r.documentCalls > r.documentChunks));
  const saved = await (await fetch(`${base}/api/runs/${result.id}`)).json(); assert.ok(saved.results.every(r => r.documentChunks > 1));
});
test('HTTP progress exposes real streamed drafts before comparison completes, then replaces them with finals', async () => {
  const id = crypto.randomUUID(); releaseStream = []; let opened = 0;
  const ready = new Promise(resolve => { streamReady = () => { if (++opened === 2) resolve(); }; });
  const form = new FormData(); form.append('task', 'stream-check'); form.append('models', JSON.stringify(localWorkers.map(m => m.id)));
  const pending = fetch(`${base}/api/compare`, { method: 'POST', headers: { 'X-Relay-Token': token, 'X-Relay-Run': id }, body: form });
  try {
    await ready;
    // Server progress can be read while both Ollama connections remain open.
    let active;
    for (let attempt = 0; attempt < 30; attempt++) {
      active = await (await fetch(`${base}/api/runs/${id}`)).json();
      if (active.results?.length === 2 && active.results.every(r => r.text === 'Local answer ')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(active.status, 'running'); assert.equal(active.results.length, 2);
    assert.ok(active.results.every(r => r.live && r.text === 'Local answer ')); assert.deepEqual(active.results.map(r => r.slot), [0, 1]);
  } finally { releaseStream.forEach(resolve => resolve()); streamReady = undefined; }
  const result = await (await pending).json(); assert.equal(result.status, 'completed'); assert.ok(result.results.every(r => !r.live && r.status === 'success' && r.text.includes('from')));
});
