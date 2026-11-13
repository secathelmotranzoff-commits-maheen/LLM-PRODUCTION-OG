import { completionStatus } from './runs.js';
import { models, validateRun, runModel } from './core.js';
import { extractDocument } from './document.js';
import { validateKeys, requireBrainKey, createBrainPlan, validateAssignments, executeBrainPlan } from './brain.js';
const lifetime = 30 * 60 * 1000;
export function registerBrainRoutes(app, { upload, runGuard, invoke, runs }) {
  const plans = new Map();
  let reservations = 0;
  function prune() { for (const [id, plan] of plans) if (plan.expiresAt <= Date.now() && plan.state !== 'running') plans.delete(id); }
  const cleanup = setInterval(prune, 60000); cleanup.unref();
  app.once('relay:close', () => clearInterval(cleanup));
  app.post('/api/brain/plan', runGuard, upload.single('pdf'), async (req, res, next) => {
    let reserved = false, job;
    try {
      prune();
      if (plans.size + reservations >= 20) throw new Error('Plan limit reached. Discard an unused plan or wait for it to expire.');
      reservations++; reserved = true;
      const output = req.body.output || 'separate';
      if (!['separate', 'combined'].includes(output)) throw new Error('Choose separate or combined output.');
      const workers = validateRun(req.body, { localOnly: true });
      const brain = models.find(m => m.id === req.body.brain);
      if (!brain || brain.provider === 'ollama') throw new Error('Choose a supported Brain model.');
      let keys; try { keys = JSON.parse(req.body.keys || '{}'); } catch { throw new Error('Invalid provider connections.'); }
      validateKeys(keys); requireBrainKey(brain, keys);
      job = await runs?.begin(req.get('X-Relay-Run') || crypto.randomUUID(), { task: req.body.task.trim(), brain: brain.id, output });
      await job?.update('Extracting document');
      const { document, pages, pageBlocks } = await extractDocument(req.file, { signal: job?.controller.signal });
      const task = req.body.task.trim();
      job?.controller.signal.throwIfAborted();
      await job?.update('Brain is planning. No workers have started.', { document });
      const call = job ? (model, prompt, key, options = {}) => (invoke || runModel)(model, prompt, key, { ...options, signal: job.controller.signal }) : invoke;
      const generated = await createBrainPlan({ task, pages, brain, workers, keys }, call);
      job?.controller.signal.throwIfAborted();
      const id = crypto.randomUUID();
      const plan = { id, task, pages, pageBlocks, document, output, brain: brain.id, workers: workers.map(m => m.id), workerModels: workers, ...generated, state: 'pending', expiresAt: Date.now() + lifetime };
      plans.set(id, plan);
      // Never store provider keys. Document text remains only in bounded, expiring server memory.
      const saved = await job?.finish({ status: 'plan_ready', stage: 'Plan ready. Approval is available in the current tab only.', plan: { summary: generated.summary, assignments: generated.assignments } });
      res.json({ ...plan, pages: undefined, pageBlocks: undefined, storageWarning: saved?.storageWarning });
    } catch (error) { if (job) await job.finish({ status: 'failed', stage: 'Planning stopped', error: job.controller.signal.aborted ? 'Planning cancelled.' : error.message }); next(job?.controller.signal.aborted ? new Error('Planning cancelled. Provider charges may still apply.') : error); }
    finally { if (reserved) reservations--; req.releaseSlot?.(); req.releaseSlot = null; }
  });
  app.post('/api/brain/execute', (req, res, next) => {
    // Reuse the concurrency guard for JSON execution, without changing its multipart requirement.
    req.brainExecution = true; next();
  }, runGuard, async (req, res, next) => {
    let plan, job, started = false, reserved = false;
    try {
      prune();
      const body = req.body || {};
      if (body.approved !== true) throw new Error('Explicit plan approval is required.');
      plan = plans.get(body.planId);
      if (!plan || plan.expiresAt <= Date.now()) throw new Error('Plan expired or unavailable. Generate a new plan.');
      if (plan.state !== 'pending') throw new Error('This plan has already been submitted. Generate a new plan to run again.');
      validateKeys(body.keys || {}); requireBrainKey(models.find(m => m.id === plan.brain), body.keys || {});
      const assignments = validateAssignments(body.assignments);
      if (!['separate', 'combined'].includes(body.output)) throw new Error('Choose separate or combined output.');
      if (body.output !== plan.output) throw new Error('Output choice differs from the reviewed plan. Generate a new plan to change output.');
      plan.state = 'starting'; reserved = true;
      job = await runs?.begin(req.get('X-Relay-Run') || crypto.randomUUID(), { task: plan.task, brain: plan.brain, output: plan.output, document: plan.document, plan: { summary: plan.summary, assignments } });
      plan.state = 'running'; started = true;
      await job?.update('Running approved local worker assignments');
      const execution = await executeBrainPlan({ plan, assignments, keys: body.keys || {}, output: body.output, signal: job?.controller.signal, onToken: job ? (slot, model, text, call) => job.stream(slot, model, text, call) : undefined, onProgress: async (stage, fields) => { if (job && fields.results) fields = { ...fields, results: [...(job.run.results || []).filter(r => !fields.results.some(done => done.slot === r.slot)), ...fields.results].sort((a, b) => a.slot - b.slot) }; return job?.update(stage, fields); } }, job ? (model, prompt, key, options = {}) => (invoke || runModel)(model, prompt, key, { ...options, signal: job.controller.signal }) : invoke);
      const saved = await job?.finish({ ...execution, stage: 'Approved workflow finished', status: completionStatus(execution.results, execution.combined) });
      res.json({ ...saved, id: saved?.id || crypto.randomUUID(), createdAt: saved?.createdAt || new Date().toISOString(), task: plan.task, document: plan.document, brain: plan.brain, plan: { summary: plan.summary, assignments }, ...execution });
    } catch (error) { if (job) await job.finish({ status: 'failed', stage: 'Execution stopped', error: job.controller.signal.aborted ? 'Execution cancelled.' : error.message }); res.status(400).json({ error: job?.controller.signal.aborted ? 'Execution cancelled. Runtime/provider work may still continue.' : error.message, planConsumed: started, runId: job?.run.id }); }
    finally {
      if (started) plans.delete(plan.id);
      else if (reserved && plan?.state === 'starting') plan.state = 'pending';
      req.releaseSlot?.(); req.releaseSlot = null;
    }
  });
  app.post('/api/brain/discard', (req, res) => {
    const plan = plans.get(req.body?.planId);
    if (['running', 'starting'].includes(plan?.state)) return res.status(409).json({ error: 'Execution is in progress.' });
    if (plan) plans.delete(plan.id);
    res.json({ discarded: true });
  });
}
