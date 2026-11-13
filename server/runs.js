import { validId } from './history.js';
export function createRunManager(store) {
  const active = new Map(), starting = new Set();
  async function persist(run) {
    try { await store.save(run); run.storageWarning = null; }
    catch { run.storageWarning = 'History could not be saved. Export the result before closing this tab.'; }
  }
  return {
    active,
    async begin(id, data) {
      if (!validId(id)) throw new Error('Invalid run ID.');
      if (active.has(id) || starting.has(id)) throw new Error('Run ID already used. No automatic retry was made.');
      starting.add(id);
      try { if (await store.get(id)) throw new Error('Run ID already used. No automatic retry was made.'); } catch (error) { starting.delete(id); throw error; }
      const run = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'running', stage: 'Starting', results: [], ...data };
      const controller = new AbortController();
      const checkpointAt = new Map();
      const job = { run, controller, finishing: false,
        async stream(slot, model, text, call = 1) {
          if (job.finishing || controller.signal.aborted) return;
          const draft = { slot, model, status: 'error', error: `INCOMPLETE live draft · local call ${call}. Not a final answer.`, text, local: true, durationMs: 0, live: true };
          run.results = [...run.results.filter(r => r.slot !== slot), draft].sort((a, b) => a.slot - b.slot);
          run.updatedAt = new Date().toISOString();
          if (Date.now() - (checkpointAt.get(slot) || 0) >= 1500) { checkpointAt.set(slot, Date.now()); await persist(run); }
        },
        async update(stage, fields = {}) { if (job.finishing) return; Object.assign(run, fields, { stage, updatedAt: new Date().toISOString() }); await persist(run); },
        finish(fields = {}) {
          if (job.completion) return job.completion;
          job.finishing = true;
          Object.assign(run, fields, { status: controller.signal.aborted ? 'cancelled' : fields.status || 'completed', updatedAt: new Date().toISOString() });
          if (controller.signal.aborted) run.stage = 'Cancelled. Provider/runtime work may still continue.';
          job.completion = (async () => { await persist(run); active.delete(id); return { ...run }; })();
          return job.completion;
        },
      };
      active.set(id, job); starting.delete(id); await persist(run); return job;
    },
    async cancel(id) { const job = active.get(id); if (!job || job.finishing) return false; job.controller.abort(); await job.update('Cancellation requested. Waiting for active calls to settle.', { status: 'cancelling' }); return true; },
    async get(id) { const job = active.get(id); return job ? { ...job.run } : store.get(id); },
  };
}

export function completionStatus(results, combined) {
  if (!results.some(r => r.status === 'success')) return 'failed';
  if (results.some(r => r.status !== 'success') || (combined && combined.status !== 'success')) return 'partial';
  return 'completed';
}
