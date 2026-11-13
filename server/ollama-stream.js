// Bounded NDJSON reader. Never treat EOF without done:true as completion.
export async function readOllamaStream(response, { signal, onToken, maxBytes = 128 * 1024 } = {}) {
  if (!response.body?.getReader) throw new Error('Ollama stream body is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', text = '', total = 0, done = false, final;
  const consume = async line => {
    if (!line.trim()) return;
    if (done) throw new Error('Ollama sent data after stream completion.');
    let data; try { data = JSON.parse(line); } catch { throw new Error('Ollama returned malformed streaming data.'); }
    if (data.error) throw new Error('Ollama reported a streaming error. Check runtime logs.');
    if (typeof data.message?.content === 'string') {
      if (Buffer.byteLength(text) + Buffer.byteLength(data.message.content) > maxBytes) throw new Error('Ollama stream exceeded the output safety limit.');
      text += data.message.content;
      await onToken?.(text);
    }
    if (data.done === true) { done = true; final = data; }
  };
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 2 * 1024 * 1024) throw new Error('Ollama stream exceeded the wire safety limit.');
      pending += decoder.decode(part.value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); await consume(line); }
      if (Buffer.byteLength(pending) > 256 * 1024) throw new Error('Ollama stream record exceeded the safety limit.');
      if (done) break;
    }
    pending += decoder.decode();
    if (pending.trim()) await consume(pending);
    if (!done) throw new Error('Ollama stream ended before completion. No automatic retry was made.');
    return { ...final, message: { content: text } };
  } catch (error) { error.partialText = text; throw error; }
  finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
