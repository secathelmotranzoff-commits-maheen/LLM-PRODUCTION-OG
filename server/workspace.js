import { mkdir, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
export const root = path.resolve(process.env.RELAY_WORKSPACE || '.relay-workspace');
export function safeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name)) throw new Error('Use a simple filename: letters, numbers, dots, underscores or hyphens. No directories.');
  if (name.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('This filename is reserved on Windows. Choose another name without a trailing dot.');
  return name;
}
export async function workspaceTool(name, args = {}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (name === 'list_files') {
    const files = await readdir(root, { withFileTypes: true });
    return files.filter(f => f.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(f.name)).map(f => f.name).sort().slice(0, 200).join('\n') || 'Workspace is empty. Create a text file to begin.';
  }
  const target = path.join(root, safeName(args.filename));
  if (name === 'read_file') {
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 32000) throw new Error('Only regular text files up to 32 KB can be read.');
      const buffer = Buffer.alloc(32001); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 32000) throw new Error('File is too large.');
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      if (text.includes('\0')) throw new Error('Binary files are not supported.');
      return text;
    } finally { await handle.close(); }
  }
  if (name === 'create_file') {
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 32000) throw new Error('Content must be text up to 32 KB.');
    const entries = await readdir(root); if (entries.length >= 200) throw new Error('Workspace limit: 200 files.');
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(args.content, 'utf8'); } finally { await handle.close(); }
    return `Created ${args.filename}. Existing files are never overwritten.`;
  }
  throw new Error('Tool not allowed.');
}
