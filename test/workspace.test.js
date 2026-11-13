import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeName } from '../server/workspace.js';
test('workspace rejects Windows device names, traversal and trailing dots', () => {
  for (const name of ['CON', 'con.txt', 'NUL.md', 'COM1', 'LPT9.log', 'file.', '../secret', 'a/b', '.env']) assert.throws(() => safeName(name));
  assert.equal(safeName('notes.txt'), 'notes.txt'); assert.equal(safeName('comparison-01.md'), 'comparison-01.md');
});
