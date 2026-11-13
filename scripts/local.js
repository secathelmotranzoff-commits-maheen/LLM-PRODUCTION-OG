// Browser-based local app launcher; no OS shell or installer downloads are executed.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, RELAY_LOCAL: '1' }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
child.on('message', message => {
  if (message?.type === 'ready') console.log(`Open http://127.0.0.1:${message.port} in your browser. Keep this terminal open; Ctrl+C stops Relay.`);
});
child.on('error', () => { console.error('Could not start Relay. Check Node.js installation.'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
