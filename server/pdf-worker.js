import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
let loading;
try {
  loading = getDocument({ data: workerData.bytes, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true });
  const document = await loading.promise;
  if (document.numPages > 50) throw new Error('Please use a PDF of 50 pages or fewer.');
  const blocks = []; let characters = 0, readable = false;
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const text = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
    if (text.trim()) readable = true;
    characters += Buffer.byteLength(text, 'utf8');
    if (characters > 100000) throw new Error('PDF text exceeds 100,000 UTF-8 bytes. Please upload a shorter document.');
    blocks.push({ page: number, text }); page.cleanup();
  }
  if (!readable) throw new Error('No readable text found. Scanned PDFs need OCR, planned for a later phase.');
  const pages = blocks.map(block => `[p. ${block.page}]\n${block.text}`).join('\n\n').trim();
  parentPort.postMessage({ ok: true, pageBlocks: blocks, pages, totalPages: document.numPages });
} catch (error) {
  const allowed = /^(Please use|PDF text exceeds|No readable text)/.test(error.message || '');
  parentPort.postMessage({ ok: false, error: allowed ? error.message : 'Could not read this PDF. It may be encrypted or damaged.' });
} finally { await loading?.destroy(); }
