function integer(name, fallback, min, max) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return Number(value);
}
export function limits() {
  return {
    localContext: integer('RELAY_LOCAL_CONTEXT', 8192, 4096, 131072),
    localOutput: integer('RELAY_LOCAL_OUTPUT', 1024, 128, 2048),
    cloudContext: integer('RELAY_BRAIN_CONTEXT', 128000, 8192, 1000000),
    maxChunks: integer('RELAY_MAX_CHUNKS', 12, 1, 32),
    pdfTimeoutMs: integer('RELAY_PDF_TIMEOUT_MS', 15000, 100, 60000),
    pdfHeapMb: integer('RELAY_PDF_HEAP_MB', 128, 64, 512),
  };
}
// Deliberately conservative byte estimate, not a provider/model tokenizer or a context guarantee.
export function estimateTokens(text) { return Buffer.byteLength(text, 'utf8'); }
export function assertPromptFits(prompt, context, output, label = 'Context') {
  const estimated = estimateTokens(prompt) + output + 512;
  if (estimated > context) throw new Error(`${label} budget exceeded (${estimated} conservative token units / ${context}). No text was silently truncated. Shorten the task/document or adjust context limits for a capable model.`);
  return estimated;
}
