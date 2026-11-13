import { readOllamaStream } from './ollama-stream.js';
import { limits, assertPromptFits } from './limits.js';
import { runDocumentTask } from './context.js';
// Only an operator-configured loopback Ollama runtime is supported. No browser-supplied URLs.
export function ollamaBase() {
  const url = new URL(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('OLLAMA_BASE_URL must be a plain loopback HTTP address.');
  return url.origin;
}
export async function discoverLocal() {
  try {
    const response = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!Array.isArray(data.models)) throw new Error('invalid response');
    const seen = new Set();
    const workers = data.models.filter(m => m && typeof m === 'object' && !m.remote_host && !m.remote_model && !/-cloud(?::|$)/i.test(m.name || '') && typeof m.name === 'string' && m.name.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(m.name) && !seen.has(m.name) && seen.add(m.name)).slice(0, 100).map(m => ({ id: `local:${m.name}`, apiModel: m.name, name: m.name, ...(Number.isFinite(m.size) && m.size >= 0 ? { sizeBytes: m.size } : {}), provider: 'ollama', family: 'Local · Ollama' }));
    return { connected: true, workers, message: workers.length >= 2 ? 'Ollama connected. Select your two installed models.' : 'Ollama connected. Install two different models, then refresh.' };
  } catch {
    return { connected: false, workers: [], message: 'No local Ollama connection. Run Relay on the same PC as Ollama, start Ollama, then refresh. The hosted preview cannot see your PC.' };
  }
}
async function requestLocal(model, prompt, { signal, outputTokens = limits().localOutput, onToken } = {}) {
  const started = Date.now();
  try {
    const config = limits(); assertPromptFits(prompt, config.localContext, outputTokens, 'Local context');
    signal?.throwIfAborted();
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
    await onToken?.('');
    const response = await fetch(`${ollamaBase()}/api/chat`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: requestSignal, body: JSON.stringify({ model: model.apiModel, stream: Boolean(onToken), messages: [{ role: 'user', content: prompt }], options: { num_predict: outputTokens, num_ctx: config.localContext }, keep_alive: '5m' }) });
    if (!response.ok) throw new Error(response.status === 404 ? 'Local model is no longer installed. Refresh models or download it in Ollama.' : 'Ollama could not run this model. Check available RAM/VRAM and the Ollama logs.');
    const data = onToken ? await readOllamaStream(response, { signal: requestSignal, onToken }) : await response.json();
    if (typeof data.message?.content !== 'string' || !data.message.content.trim()) throw new Error('Local model returned no text.');
    const truncated = data.done_reason === 'length';
    return { model: model.id, status: truncated ? 'error' : 'success', ...(truncated ? { error: 'Local model reached its output limit. This response is incomplete; no automatic retry was made.' } : {}), text: data.message.content, durationMs: Date.now() - started, usage: { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count }, local: true };
  } catch (error) {
    return { model: model.id, status: 'error', ...(error.partialText ? { text: error.partialText } : {}), durationMs: Date.now() - started, error: signal?.aborted ? 'Local request cancelled. Ollama may still be working internally.' : error.name === 'TimeoutError' ? 'Local model timed out after 5 minutes. Try a smaller model or shorter PDF.' : /^(Local model|Local context|Ollama)/.test(error.message) ? error.message : 'Could not reach local Ollama. Start Ollama on this PC and try again.' };
  }
}

export async function runLocalModel(model, prompt, options = {}) {
  const started = Date.now();
  try {
    const result = options.pageBlocks?.length ? await runDocumentTask(model, { task: options.task, pageBlocks: options.pageBlocks, assignment: options.assignment, signal: options.signal, onProgress: options.onProgress, onToken: options.onToken }, requestLocal) : await requestLocal(model, prompt, options);
    return { ...result, durationMs: Date.now() - started };
  } catch (error) {
    return { ...(error.partialResult || {}), model: model.id, status: 'error', error: options.signal?.aborted ? 'Local request cancelled. Runtime work may still continue.' : error.message, durationMs: Date.now() - started, local: true };
  }
}
