import { test } from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { extractDocument, runPdfWorker } from '../server/document.js';
async function pdf(text) {
  const doc = new PDFDocument(); const chunks = []; const done = new Promise(resolve => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  if (text) doc.text(text); doc.end(); return done;
}
test('real worker extracts page blocks and rejects blank text documents', async () => {
  const result = await extractDocument({ buffer: await pdf('Evidence for extraction.'), originalname: 'source.pdf' });
  assert.equal(result.document.pages, 1); assert.match(result.pageBlocks[0].text, /Evidence/); assert.match(result.pages, /\[p\. 1\]/);
  await assert.rejects(extractDocument({ buffer: await pdf(''), originalname: 'blank.pdf' }), /No readable text/);
});
test('hung PDF worker is terminated by wall timeout', async () => {
  await assert.rejects(runPdfWorker(Buffer.from('fixture'), { workerUrl: new URL('../test-support/pdf-hang.js', import.meta.url), timeoutMs: 100 }), /timed out/);
});
test('PDF cancellation terminates the worker and rejects without returning partial pages', async () => {
  const controller = new AbortController(); const pending = runPdfWorker(Buffer.from('fixture'), { workerUrl: new URL('../test-support/pdf-hang.js', import.meta.url), signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /cancelled/);
});
test('already cancelled PDF extraction never starts a worker', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runPdfWorker(Buffer.from('fixture'), { signal: controller.signal, workerUrl: new URL('./does-not-exist.js', import.meta.url) }), error => error.name === 'AbortError');
});
