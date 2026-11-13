import os from 'node:os';
import { discoverLocal, ollamaBase } from './local.js';
import { limits } from './limits.js';
export async function diagnostics() {
  const started = Date.now();
  const [local, version] = await Promise.all([
    discoverLocal(),
    (async () => { try { const response = await fetch(`${ollamaBase()}/api/version`, { signal: AbortSignal.timeout(3000), redirect: 'error' }); if (!response.ok) return null; const data = await response.json(); return typeof data.version === 'string' ? data.version.slice(0, 60) : null; } catch { return null; } })(),
  ]);
  return {
    scope: 'The computer running the Relay server, not necessarily the browser device. Hosted preview reports sandbox resources.',
    system: { platform: os.platform(), architecture: os.arch(), node: process.versions.node, cpuThreads: os.availableParallelism(), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), processAvailableMemoryBytes: process.availableMemory?.() || null },
    runtime: { connected: local.connected, message: local.message, version, modelCount: local.workers.length, models: local.workers.map(m => ({ name: m.name, sizeBytes: m.sizeBytes || null })), checkDurationMs: Date.now() - started },
    limits: limits(),
    warnings: [
      'Model disk size is not required RAM/VRAM. GPU memory and model-specific context capabilities have not been measured.',
      'Reported OS RAM may exceed container limits. Free memory changes during execution.',
      'Context estimates use UTF-8 bytes as conservative units, not the selected model tokenizer. Verify the model supports the configured context.',
      ...(local.workers.length < 2 ? ['Two installed local models are required for the production slots.'] : []),
      ...(os.freemem() < 4 * 1024 ** 3 ? ['Less than 4 GiB of OS-reported free RAM. Start with small models; this is not a fit guarantee.'] : []),
    ],
  };
}
