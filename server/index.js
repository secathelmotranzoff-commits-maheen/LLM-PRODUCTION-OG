import { limits } from './limits.js';
import { diagnostics } from './diagnostics.js';
import { completionStatus } from './runs.js';
import { HistoryStore } from './history.js';
import { createRunManager } from './runs.js';
import path from 'node:path';
import { parsePort } from './settings.js';
import { discoverLocal } from './local.js';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { extractDocument } from './document.js';
import { registerBrainRoutes } from './brain-routes.js';
import { randomBytes } from 'node:crypto';
import { getMcp, closeMcp } from './mcp-client.js';
import { fileURLToPath } from 'node:url';
import { models, registerLocalModels, validateRun, makePrompt, runModel } from './core.js';
limits(); // Validate configured safety bounds before starting the server.
const store = new HistoryStore(path.join(process.env.RELAY_DATA_DIR || '.relay-data', 'history'));
await store.init();
const runs = createRunManager(store);
const app = express();
app.disable('x-powered-by');
if (process.env.RELAY_LOCAL === '1') app.use((req, res, next) => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: 'Local app requires a localhost address.' });
  next();
});
const sessionToken = randomBytes(32).toString('hex');
app.use(express.json({ limit: '48kb' }));
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && req.get('X-Relay-Token') !== sessionToken) return res.status(403).json({ error: 'Refresh the workspace before making changes.' });
  next();
});
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://*.e2b.app");
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 15000 } });
app.get('/api/config', async (req, res) => {
  const local = await discoverLocal(); registerLocalModels(local.workers);
  res.json({ token: sessionToken, limits: limits(), models: [...models.filter(m => m.provider !== 'ollama'), ...local.workers], local, configured: {} });
});
// Limits are for a local/single-user prototype, not a substitute for production auth and quotas.
let active = 0;
const runGuard = (req, res, next) => {
  if (!req.brainExecution && !req.is('multipart/form-data')) return res.status(415).json({ error: 'Expected multipart form data.' });
  if (active >= 3) return res.status(429).json({ error: 'Workspace is busy. Try again shortly.' });
  active++;
  req.releaseSlot = () => { active--; };
  req.once('aborted', () => { /* Slot remains occupied until execution settles. */ });
  next();
};
app.post('/api/compare', runGuard, upload.single('pdf'), async (req, res, next) => {
  let job;
  try {
    const selected = validateRun(req.body, { localOnly: true });
    job = await runs.begin(req.get('X-Relay-Run') || crypto.randomUUID(), { task: req.body.task.trim(), output: 'separate' });
    await job.update('Extracting document');
    const { document, pages, pageBlocks } = await extractDocument(req.file, { signal: job.controller.signal });
    job.controller.signal.throwIfAborted();
    await job.update('Running local workers', { document });
    const prompt = makePrompt(req.body.task.trim(), pages);
    const results = await Promise.all(selected.map(async (model, slot) => {
      const result = { ...await runModel(model, prompt, undefined, { signal: job.controller.signal, pageBlocks, task: req.body.task.trim(), onToken: (text, call) => job.stream(slot, model.id, text, call), onProgress: stage => job.update(`${model.name}: ${stage}`) }), slot };
      await job.update(`Worker settled: ${model.name}`, { results: [...job.run.results.filter(r => r.slot !== slot), result].sort((a, b) => a.slot - b.slot) });
      return result;
    }));
    res.json(await job.finish({ results, stage: 'Local comparison finished', status: completionStatus(results) }));
  } catch (error) { if (job) await job.finish({ status: 'failed', stage: job.controller.signal.aborted ? 'Cancelled' : 'Run failed', error: job.controller.signal.aborted ? 'Request cancelled.' : error.message }); next(job?.controller.signal.aborted ? new Error('Request cancelled. Runtime work may still continue.') : error); }
  finally { req.releaseSlot?.(); req.releaseSlot = null; }
});
app.get('/api/diagnostics', async (req, res) => { try { res.json(await diagnostics()); } catch { res.status(503).json({ error: 'Could not collect diagnostics. Check configured context and runtime settings.' }); } });
registerBrainRoutes(app, { upload, runGuard, runs });
app.get('/api/runs', async (req, res, next) => { try { const saved = await store.list(); res.json({ runs: saved, warning: store.skipped ? `${store.skipped} damaged history record(s) were skipped. Files were left on disk for manual recovery.` : null }); } catch { res.status(503).json({ error: 'Saved history is unavailable.' }); } });
app.get('/api/runs/:id', async (req, res) => {
  try { const run = await runs.get(req.params.id); if (!run) return res.status(404).json({ error: 'Run not found.' }); res.json(run); }
  catch { res.status(400).json({ error: 'Invalid or unreadable run.' }); }
});
app.post('/api/runs/:id/cancel', async (req, res) => {
  if (!await runs.cancel(req.params.id)) return res.status(409).json({ error: 'Run is not active. No request was retried.' });
  res.json({ cancelling: true, warning: 'Provider/runtime work may continue after cancellation.' });
});
app.post('/api/runs/:id/delete', async (req, res) => {
  if (runs.active.has(req.params.id)) return res.status(409).json({ error: 'Cancel the run and wait for it to settle before deleting.' });
  try { await store.remove(req.params.id); res.json({ deleted: true }); } catch { res.status(400).json({ error: 'Invalid run or history deletion failed.' }); }
});
let toolBusy = false;
app.get('/api/mcp/tools', async (req, res) => {
  try { res.json(await (await getMcp()).listTools()); }
  catch { res.status(503).json({ error: 'MCP workspace connection unavailable.' }); }
});
app.post('/api/mcp/call', async (req, res) => {
  const { name, arguments: args, approved } = req.body || {};
  if (!['list_files', 'read_file', 'create_file'].includes(name)) return res.status(400).json({ error: 'Tool not allowed.' });
  if (!args || typeof args !== 'object' || Array.isArray(args)) return res.status(400).json({ error: 'Invalid tool arguments.' });
  if (name === 'create_file' && approved !== true) return res.status(403).json({ error: 'Explicit approval is required to create a file.' });
  if (toolBusy) return res.status(429).json({ error: 'Another workspace tool is running.' });
  toolBusy = true;
  try {
    const result = await (await getMcp()).callTool({ name, arguments: args });
    res.json(result);
  } catch { res.status(502).json({ error: 'MCP call failed. Retry the connection.' }); }
  finally { toolBusy = false; }
});
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((error, req, res, next) => {
  if (req.releaseSlot) { req.releaseSlot(); req.releaseSlot = null; }
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request body.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'JSON request exceeds the 48 KB limit.' });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'PDF must be 10 MB or smaller.' : 'Upload exceeds the allowed limits.' });
  res.status(400).json({ error: error.message || 'Unable to complete the request.' });
});
const port = parsePort(process.env.PORT || '3000');
const httpServer = app.listen(port, process.env.RELAY_LOCAL === '1' ? '127.0.0.1' : '0.0.0.0', () => {
  const actualPort = httpServer.address().port;
  console.log(`Relay workspace listening on port ${actualPort}`);
  process.send?.({ type: 'ready', port: actualPort });
});
httpServer.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the existing app or set a different PORT in .env.` : 'Relay could not start its HTTP server. Check PORT and permissions.');
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { app.emit('relay:close'); httpServer.close(); await closeMcp(); process.exit(0); });
