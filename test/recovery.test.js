import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parsePort } from '../server/settings.js';
import { getMcp, closeMcp } from '../server/mcp-client.js';
test('PORT validation rejects named pipes, negatives and out-of-range values', () => {
  for (const value of ['abc', '-1', '70000', '3000.5', '../socket']) assert.throws(() => parsePort(value));
  assert.equal(parsePort('0'), 0); assert.equal(parsePort('3001'), 3001);
});
test('local launcher prints actual ready port, not guessed environment default', async t => {
  const child = spawn(process.execPath, ['scripts/local.js'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } });
  const output = await new Promise((resolve, reject) => {
    let text = ''; const timeout = setTimeout(() => reject(new Error('Launcher not ready')), 10000);
    child.stdout.on('data', data => { text += data; if (text.includes('Keep this terminal')) { clearTimeout(timeout); resolve(text); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  const match = output.match(/Open http:\/\/127\.0\.0\.1:(\d+)/); assert.ok(match); assert.notEqual(Number(match[1]), 0);
  assert.equal((await fetch(`http://127.0.0.1:${match[1]}/`)).status, 200);
});
test('MCP reconnects after the cached client transport closes', async t => {
  t.after(closeMcp);
  const first = await getMcp(); assert.equal((await first.listTools()).tools.length, 3);
  await first.close();
  const second = await getMcp(); assert.notEqual(first, second); assert.equal((await second.listTools()).tools.length, 3);
});
