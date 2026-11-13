import { Worker } from 'node:worker_threads';
import { limits } from './limits.js';
export async function runPdfWorker(bytes, { signal, timeoutMs = limits().pdfTimeoutMs, heapMb = limits().pdfHeapMb, workerUrl = new URL('./pdf-worker.js', import.meta.url) } = {}) {
  signal?.throwIfAborted();
  const data = Uint8Array.from(bytes);
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const finish = async (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      try { await worker?.terminate(); } catch { /* Always settle even if worker teardown fails. */ }
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error('PDF extraction cancelled.'));
    try {
      worker = new Worker(workerUrl, { workerData: { bytes: data }, env: {}, transferList: [data.buffer], resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: 16 } });
      timer = setTimeout(() => finish(new Error('PDF extraction timed out. Use a smaller or simpler PDF.')), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      worker.once('message', message => {
        if (!message?.ok) finish(new Error(message?.error || 'PDF extraction failed.'));
        else finish(null, message);
      });
      worker.once('error', error => finish(new Error(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'PDF extraction exceeded its JavaScript heap limit. Use a smaller PDF.' : 'PDF extraction worker failed. Try a smaller or simpler PDF.')));
      worker.once('exit', () => { if (!settled) finish(new Error('PDF extraction worker stopped before returning text.')); });
    } catch { finish(new Error('Could not start PDF extraction worker.')); }
  });
}
export async function extractDocument(file, { signal } = {}) {
  if (!file) return { document: null, pages: '', pageBlocks: [] };
  if (!file.buffer || file.buffer.length > 10 * 1024 * 1024) throw new Error('PDF must be 10 MB or smaller.');
  if (!file.buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new Error('Upload a valid PDF document.');
  const extracted = await runPdfWorker(file.buffer, { signal });
  return { document: { name: file.originalname, pages: extracted.totalPages, characters: extracted.pages.length }, pages: extracted.pages, pageBlocks: extracted.pageBlocks };
}
