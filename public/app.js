const $ = id => document.getElementById(id);
let config = { models: [], configured: {} }, keys = {}, history = [], current = null, busy = false, mode = 'compare', pendingPlan = null, refreshing = false, activeRunId = null, progressTimer = null;
const providers = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
function notice(message) { $('notice').hidden = !message; $('notice').textContent = message; }
function updateConnections() {
  for (const slot of ['a', 'b', 'brain']) {
    const model = config.models.find(m => m.id === $(`model-${slot}`).value);
    const ready = model && (slot === 'brain' ? keys[model.provider] : model.provider === 'ollama' && config.local?.connected);
    const el = $(`state-${slot}`); el.textContent = slot === 'brain' ? (ready ? '● Your key available · not verified' : '○ Your Brain API key needed') : (ready ? '● Installed locally · no API key' : '○ Connect local Ollama'); el.classList.toggle('connected', Boolean(ready));
  }
}
function openConnections() {
  for (const provider of Object.keys(providers)) $(`key-${provider}`).value = keys[provider] || '';
  $('connections-dialog').showModal();
}
for (const id of ['connections-button', 'top-connect']) $(id).onclick = openConnections;
document.querySelectorAll('.connect-inline').forEach(button => button.onclick = () => button.closest('.brain-card') ? openConnections() : $('setup-dialog').showModal());
$('save-keys').onclick = () => {
  if (busy) return notice('Wait until the current run finishes before changing keys.');
  keys = Object.fromEntries(Object.keys(providers).map(provider => [provider, $(`key-${provider}`).value.trim()]).filter(([, key]) => key));
  Object.keys(providers).forEach(provider => $(`key-${provider}`).value = '');
  $('connections-dialog').close(); updateConnections();
};
$('clear-keys').onclick = () => { if (busy) return; keys = {}; Object.keys(providers).forEach(p => $(`key-${p}`).value = ''); updateConnections(); };
$('connections-dialog').addEventListener('close', () => Object.keys(providers).forEach(p => $(`key-${p}`).value = ''));
document.querySelectorAll('[data-prompt]').forEach(button => button.onclick = () => { $('task').value = button.dataset.prompt; updateContextHint(); $('task').focus(); });
function fileChanged() {
  const file = $('pdf').files[0];
  if (file && (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.pdf'))) {
    $('pdf').value = ''; notice('Choose a PDF document of 10 MB or smaller.'); return fileChanged();
  }
  $('file-name').textContent = file ? file.name : 'Bring some context';
  $('file-detail').textContent = file ? `${(file.size / 1024).toFixed(0)} KB · Ready for local workers; shared with cloud only in Brain mode` : 'Drop a PDF here, or click to browse';
  $('remove-file').hidden = !file;
}
$('pdf').onchange = fileChanged;
$('remove-file').onclick = () => { $('pdf').value = ''; fileChanged(); };
$('dropzone').ondragover = event => { event.preventDefault(); $('dropzone').classList.add('dragging'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragging');
$('dropzone').ondrop = event => { event.preventDefault(); if (lockedState()) return; $('dropzone').classList.remove('dragging'); if (event.dataTransfer.files.length) { $('pdf').files = event.dataTransfer.files; fileChanged(); } };
function renderResult(result, label) {
  const model = config.models.find(m => m.id === result.model);
  const card = document.createElement('article'); card.className = 'result-card';
  const title = document.createElement('div'); title.className = 'result-title';
  const name = document.createElement('strong'); name.textContent = `${label ? label + ' · ' : ''}${model?.name || result.model}`;
  const time = document.createElement('small'); time.textContent = `${result.live ? 'Live draft' : result.status === 'success' ? 'Completed' : 'Needs attention'} · ${(result.durationMs / 1000).toFixed(1)}s`;
  title.append(name, time);
  const body = document.createElement('div'); body.className = `result-body${result.status === 'error' ? ' error' : ''}`; body.textContent = [result.status === 'error' ? result.error : null, result.text].filter(Boolean).join('\n\n');
  card.append(title, body); if (result.documentChunks) { const note = document.createElement('p'); note.className = 'chunk-meta'; note.textContent = `${result.documentChunks} source chunk(s) · ${result.documentCalls || 1} local call(s) · Model summaries are not verified citations.`; card.append(note); } return card;
}
function showResults(run) {
  current = run; $('results').hidden = false; $('result-grid').replaceChildren();
  const status = document.createElement('p'); status.className = 'saved-run-status'; status.textContent = `${run.status || 'completed'} · ${run.stage || ''}${run.error ? ' · ' + run.error : ''}`; $('result-grid').append(status);
  if (run.plan?.summary) { const summary = document.createElement('p'); summary.textContent = run.plan.summary; summary.className = 'saved-run-status'; $('result-grid').append(summary); }
  $('result-grid').classList.toggle('combined-view', Boolean(run.combined));
  $('result-meta').textContent = `${run.document ? `${run.document.name} · ${run.document.pages} pages` : 'Text-only task'} · ${new Date(run.createdAt).toLocaleTimeString()} · ${run.brain ? 'Brain-directed workflow' : 'Independent comparison'} · Verify model-generated citations against the original.`;
  if (!['running', 'cancelling'].includes(run.status)) run = { ...run, results: (run.results || []).map(r => ({ ...r, live: false })) };
  if (run.combined) {
    $('result-grid').append(renderResult(run.combined, 'Combined report'));
    const details = document.createElement('details'); details.className = 'worker-details';
    const summary = document.createElement('summary'); summary.textContent = 'View the two original worker responses'; details.append(summary);
    const grid = document.createElement('div'); grid.className = 'result-grid'; run.results.forEach((r, i) => grid.append(renderResult(r, `Worker ${(r.slot ?? i) === 0 ? 'A' : 'B'}`))); details.append(grid); $('result-grid').append(details);
  } else (run.results || []).forEach((r, i) => $('result-grid').append(renderResult(r, `Worker ${(r.slot ?? i) === 0 ? 'A' : 'B'}`)));
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function recordRun(run) { history.unshift(run); history = history.slice(0, 20); $('history-count').textContent = history.length; showResults(run); }
function refreshControls() {
  $('refresh-local').disabled = lockedState();
  $('run-button').textContent = busy ? 'Working…' : mode === 'brain' ? 'Generate plan ↗' : 'Run comparison ↗';
  const locked = lockedState();
  $('task-form').querySelectorAll('button, textarea, select, input').forEach(el => el.disabled = locked);
  $('run-button').disabled = locked || config.models.filter(m => m.provider === 'ollama').length < 2;
  $('task-form').classList.toggle('plan-locked', Boolean(pendingPlan));
  $('task-form').setAttribute('aria-busy', String(busy));
  $('compare-mode').disabled = locked; $('brain-mode').disabled = locked;
  $('execute-plan').disabled = busy || refreshing; $('discard-plan').disabled = busy || refreshing;
  $('assignment-a').disabled = busy; $('assignment-b').disabled = busy; $('approve-plan').disabled = busy;
}
function setMode(nextMode) {
  if (lockedState()) return notice('Finish or discard the current plan before changing modes.');
  mode = nextMode; $('compare-mode').classList.toggle('selected', mode === 'compare'); $('brain-mode').classList.toggle('selected', mode === 'brain');
  $('brain-settings').hidden = mode !== 'brain'; $('output-control').hidden = mode !== 'brain'; $('compare-description').hidden = mode === 'brain';
  $('output-description').textContent = mode === 'brain' ? 'Brain-directed output' : 'Side-by-side output';
  document.querySelector('.mode-description').textContent = mode === 'brain' ? 'Plan → approve → execute → review' : 'Independent thinking. Side-by-side results.';
  refreshControls();
}
$('compare-mode').onclick = () => setMode('compare');
$('brain-mode').onclick = $('brain-nav').onclick = () => setMode('brain');
async function jsonPost(url, body, runId) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Token': config.token, ...(runId ? { 'X-Relay-Run': runId } : {}) }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { planConsumed: data.planConsumed, runId: data.runId }); return data;
}
$('task-form').onsubmit = async event => {
  event.preventDefault(); if (lockedState()) return;
  const selected = [$('model-a').value, $('model-b').value];
  if (selected[0] === selected[1]) return notice('Choose two different models for the workers.');
  const brain = config.models.find(m => m.id === $('model-brain').value);
  if (mode === 'brain' && !keys[brain?.provider]) { notice('The Brain needs your own session API key. Server keys are not used for Brain calls.'); return openConnections(); }
  if (!selected.every(id => config.models.some(m => m.id === id && m.provider === 'ollama'))) { notice('Connect Ollama and choose two installed local models.'); return $('setup-dialog').showModal(); }
  const form = new FormData(); form.append('task', $('task').value); form.append('models', JSON.stringify(selected));
  if (mode === 'brain') { form.append('keys', JSON.stringify(keys)); form.append('brain', brain.id); form.append('output', $('output-mode').value); }
  if ($('pdf').files[0]) form.append('pdf', $('pdf').files[0]);
  busy = true; const runId = startProgress(); refreshControls(); $('results').hidden = true;
  notice(mode === 'brain' ? 'Brain is preparing assignments. Workers will not run until you approve.' : 'Running both local models. Model loading may take several minutes; Ollama may queue work to fit your hardware.');
  try {
    const response = await fetch(mode === 'brain' ? '/api/brain/plan' : '/api/compare', { method: 'POST', headers: { 'X-Relay-Token': config.token, 'X-Relay-Run': runId }, body: form });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.');
    if (mode === 'brain') {
      pendingPlan = data; $('plan-summary').textContent = data.summary;
      $('plan-meta').textContent = `${brain.name} · ${data.document ? data.document.name + ' · ' + data.document.pages + ' pages' : 'Text-only task'} · ${$('output-mode').value === 'combined' ? 'Combined report' : 'Separate answers'} · Expires ${new Date(data.expiresAt).toLocaleTimeString()}`;
      for (const [i, slot] of ['a', 'b'].entries()) { $(`assignment-${slot}`).value = data.assignments[i]; $(`assignment-label-${slot}`).textContent = `Worker ${slot.toUpperCase()} · ${config.models.find(m => m.id === data.workers[i]).name}`; }
      $('approve-plan').checked = false; $('plan-panel').hidden = false; $('plan-panel').scrollIntoView({ behavior: 'smooth' });
    } else recordRun(data);
    notice(data.storageWarning || (data.status === 'cancelled' ? 'Run cancelled. Runtime/provider work may still continue.' : ''));
  } catch (error) { notice(error.message || 'Could not reach the workspace server.'); }
  finally { stopProgress(); busy = false; refreshControls(); }
};
$('execute-plan').onclick = async () => {
  if (busy || !pendingPlan) return;
  if (!$('approve-plan').checked) return notice('Review the assignments and check the approval box first.');
  const assignments = [$('assignment-a').value.trim(), $('assignment-b').value.trim()];
  if (assignments.some(s => !s)) return notice('Both workers need a non-empty assignment.');
  const brain = config.models.find(m => m.id === pendingPlan.brain);
  if (!keys[brain.provider]) { notice('Reconnect your Brain key before executing.'); return openConnections(); }
  busy = true; const runId = startProgress(); refreshControls(); notice('Executing approved assignments. A combined report adds one Brain review call after the workers finish.');
  try {
    const data = await jsonPost('/api/brain/execute', { planId: pendingPlan.id, approved: true, assignments, output: $('output-mode').value, keys }, runId);
    pendingPlan = null; $('plan-panel').hidden = true; recordRun(data); notice(data.storageWarning || (data.status === 'cancelled' ? 'Run cancelled. Check partial results below.' : ''));
  } catch (error) {
    // Unknown network outcomes must never invite a second charged execution.
    if (error.planConsumed !== false) {
      pendingPlan = null; $('plan-panel').hidden = true;
      try { const response = await fetch(`/api/runs/${error.runId || runId}`); if (response.ok) { const recovered = await response.json(); if (Array.isArray(recovered.results)) showResults(recovered); } } catch { /* Read-only recovery is optional. */ }
    }
    notice(`${error.message} No automatic retry was made. Check Saved runs for partial results or active work. ${error.planConsumed === false ? 'Workers did not start; you can correct this request.' : 'Generate a new plan only if you intentionally want another run.'}`);
  } finally { stopProgress(); busy = false; $('approve-plan').checked = false; refreshControls(); }
};
$('discard-plan').onclick = async () => {
  if (busy || !pendingPlan) return;
  busy = true; refreshControls();
  try { await jsonPost('/api/brain/discard', { planId: pendingPlan.id }); pendingPlan = null; $('plan-panel').hidden = true; notice('Plan discarded.'); }
  catch (error) { notice(error.message); }
  finally { busy = false; refreshControls(); }
};
for (const slot of ['a', 'b']) $(`assignment-${slot}`).addEventListener('input', () => $('approve-plan').checked = false);
$('history-button').onclick = async () => {
  $('history-dialog').showModal(); await renderHistory();
};
async function renderHistory() {
  $('history-notice').textContent = ''; $('history-list').replaceChildren(); $('history-list').textContent = 'Loading saved runs…';
  let entries = history;
  try { const response = await fetch('/api/runs'); if (!response.ok) throw new Error(); const data = await response.json(); if (!Array.isArray(data.runs)) throw new Error('Invalid history response.'); entries = data.runs; $('history-notice').textContent = data.warning || ''; }
  catch { $('history-notice').textContent = 'Saved history unavailable. Showing this tab’s results only.'; }
  $('history-list').replaceChildren(); $('history-count').textContent = entries.length;
  if (!entries.length) $('history-list').textContent = 'No saved runs yet.';
  entries.forEach(run => {
    const row = document.createElement('div'); row.className = 'saved-run-row';
    const button = document.createElement('button'); button.className = 'history-item'; button.textContent = (run.task || 'Untitled task').slice(0, 110);
    const meta = document.createElement('small'); meta.textContent = `${new Date(run.createdAt).toLocaleString()} · ${run.status || 'completed'} · ${run.stage || ''}`; button.append(meta);
    button.onclick = async () => {
      try { const response = await fetch(`/api/runs/${run.id}`); if (!response.ok) throw new Error('Could not open saved run.'); const saved = await response.json(); $('history-dialog').close(); showResults(saved); }
      catch (error) { if (run.results) { $('history-dialog').close(); showResults(run); } else $('history-notice').textContent = error.message; }
    };
    const remove = document.createElement('button'); remove.className = 'quiet'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', 'Delete saved run');
    remove.onclick = async () => {
      if (!window.confirm('Delete this saved run? Tasks and outputs will be removed from Relay history. Exports and provider records are not deleted.')) return;
      try { await jsonPost(`/api/runs/${run.id}/delete`, {}); history = history.filter(item => item.id !== run.id); if (current?.id === run.id) { current = null; $('results').hidden = true; } await renderHistory(); }
      catch (error) { $('history-notice').textContent = error.message; }
    };
    row.append(button);
    if (['running', 'cancelling'].includes(run.status)) {
      const cancel = document.createElement('button'); cancel.className = 'quiet'; cancel.textContent = 'Cancel';
      cancel.onclick = async () => {
        cancel.disabled = true;
        try { await jsonPost(`/api/runs/${run.id}/cancel`, {}); await renderHistory(); $('history-notice').textContent = 'Cancellation requested. Provider/runtime work may still continue.'; }
        catch (error) { $('history-notice').textContent = error.message; cancel.disabled = false; }
      }; row.append(cancel);
    }
    row.append(remove); $('history-list').append(row);
  });
}
$('new-workspace').onclick = () => { if (lockedState()) return notice('Finish or discard the current plan first.'); $('task').value = ''; $('pdf').value = ''; fileChanged(); $('results').hidden = true; current = null; notice(''); $('task').focus(); };
$('export-button').onclick = () => {
  if (!current) return;
  const exportedResults = current.combined ? [...current.results, { ...current.combined, label: 'Combined report', model: current.brain }] : current.results;
  const markdown = `# Relay workflow\n\n${current.task}\n\nRun status: ${current.status || 'unknown'}${current.error ? ` · ${current.error}` : ''}\n\n${current.document ? `Document: ${current.document.name}\n\n` : ''}${exportedResults.map(r => `## ${r.label ? r.label + ' · ' : `Worker ${(r.slot ?? exportedResults.indexOf(r)) === 0 ? 'A' : 'B'} · `}${config.models.find(m => m.id === r.model)?.name || r.model}\n\n${[r.status === 'error' ? `INCOMPLETE / ERROR: ${r.error || 'Model request failed.'}` : null, r.text].filter(Boolean).join('\n\n')}`).join('\n\n---\n\n')}`;
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' })); const link = document.createElement('a'); link.href = url; link.download = `relay-${current.id.slice(0, 8)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function init() {
  try {
    const response = await fetch('/api/config'); if (!response.ok) throw new Error('Configuration unavailable.'); config = await response.json();
    populateModels(); updateContextHint();
    for (const [provider, name] of Object.entries(providers)) {
      const row = document.createElement('div'); row.className = 'key-row';
      const label = document.createElement('label'); label.htmlFor = `key-${provider}`; label.textContent = name;
      const status = document.createElement('span'); status.textContent = config.configured[provider] ? 'Server key available' : 'Bring your own key'; label.append(status);
      const input = document.createElement('input'); input.id = `key-${provider}`; input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = `${name} API key`; input.maxLength = 500;
      row.append(label, input); $('key-fields').append(row);
    } updateConnections(); refreshControls();
  } catch { notice('Unable to load workspace configuration. Refresh to try again.'); $('run-button').disabled = true; }
}
init();

$('mcp-button').onclick = async () => {
  $('mcp-dialog').showModal();
  try { const response = await fetch('/api/mcp/tools'); const data = await response.json(); if (!response.ok) throw new Error(data.error); $('mcp-tools').textContent = `Connected via MCP stdio · ${data.tools.map(t => t.name).join(' · ')}`; }
  catch (error) { $('mcp-tools').textContent = error.message; }
};
async function callTool(name) {
  const approved = $('mcp-approve').checked;
  if (name === 'create_file' && !approved) { $('mcp-output').textContent = 'Approve the file creation first.'; return; }
  const buttons = ['mcp-list', 'mcp-read', 'mcp-create']; buttons.forEach(id => $(id).disabled = true);
  $('mcp-output').textContent = 'Running MCP tool…';
  try {
    const response = await fetch('/api/mcp/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Token': config.token }, body: JSON.stringify({ name, arguments: { filename: $('mcp-filename').value, content: $('mcp-content').value }, approved }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    $('mcp-output').textContent = `${result.isError ? 'Tool error: ' : ''}${result.content.filter(c => c.type === 'text').map(c => c.text).join('\n')}`;
  } catch (error) { $('mcp-output').textContent = error.message; }
  finally { buttons.forEach(id => $(id).disabled = false); $('mcp-approve').checked = false; }
}
$('mcp-list').onclick = () => callTool('list_files');
$('mcp-read').onclick = () => callTool('read_file');
$('mcp-create').onclick = () => callTool('create_file');
for (const id of ['mcp-filename', 'mcp-content']) $(id).addEventListener('input', () => $('mcp-approve').checked = false);

function lockedState() { return busy || refreshing || Boolean(pendingPlan); }
function populateModels() {
  for (const slot of ['a', 'b', 'brain']) {
    const select = $(`model-${slot}`), previous = select.value;
    select.replaceChildren();
    const options = config.models.filter(m => slot === 'brain' ? m.provider !== 'ollama' : m.provider === 'ollama');
    options.forEach(model => { const option = document.createElement('option'); option.value = model.id; option.textContent = `${model.name} / ${model.family}`; select.append(option); });
    if (options.some(m => m.id === previous)) select.value = previous;
    else select.selectedIndex = slot === 'b' && options.length > 1 ? 1 : 0;
    if (!options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No local models — see setup'; select.append(option); }
    select.onchange = updateConnections;
  }
  $('local-status').textContent = config.local?.message || 'Local Ollama status unavailable.';
}
$('local-setup').onclick = () => $('setup-dialog').showModal();
$('copy-local-command').onclick = async () => {
  try { await navigator.clipboard.writeText($('local-command').textContent); $('copy-local-command').textContent = 'Copied'; }
  catch { $('copy-local-command').textContent = 'Select and copy the commands above'; }
};
$('refresh-local').onclick = async () => {
  if (lockedState()) return;
  refreshing = true; refreshControls(); $('local-status').textContent = 'Checking installed models…';
  try { const response = await fetch('/api/config'); if (!response.ok) throw new Error('Connection check failed.'); config = await response.json(); populateModels(); updateContextHint(); updateConnections(); refreshControls(); }
  catch (error) { $('local-status').textContent = error.message; }
  finally { refreshing = false; refreshControls(); }
};

function startProgress() {
  activeRunId = crypto.randomUUID(); $('run-progress').hidden = false; $('progress-stage').textContent = 'Starting run…'; $('progress-detail').textContent = 'Preparing your request.'; $('cancel-run').disabled = false;
  const id = activeRunId;
  let live = $('live-workers'); if (!live) { live = document.createElement('div'); live.id = 'live-workers'; $('run-progress').append(live); } live.replaceChildren();
  let checking = false;
  progressTimer = setInterval(async () => {
    if (checking || activeRunId !== id) return; checking = true;
    try { const response = await fetch(`/api/runs/${id}`); if (!response.ok) return; const run = await response.json(); if (activeRunId !== id) return; $('progress-stage').textContent = run.stage || run.status; $('progress-detail').textContent = `${run.results?.filter(r => !r.live).length || 0} worker responses recorded · ${run.status}`; live.replaceChildren(...(run.results || []).map(r => renderResult({ ...r, live: r.live && ['running', 'cancelling'].includes(run.status) }, `Worker ${r.slot === 1 ? 'B' : 'A'}`)));  }
    catch { /* The original request owns error reporting; never retry model work here. */ }
    finally { checking = false; }
  }, 1000);
  return id;
}
function stopProgress() { clearInterval(progressTimer); progressTimer = null; activeRunId = null; $('run-progress').hidden = true; }
$('cancel-run').onclick = async () => {
  if (!activeRunId) return; $('cancel-run').disabled = true;
  try { await jsonPost(`/api/runs/${activeRunId}/cancel`, {}); $('progress-stage').textContent = 'Cancellation requested'; $('progress-detail').textContent = 'Relay is aborting pending calls. Runtime/provider work or charges may still continue.'; }
  catch (error) { $('cancel-run').disabled = false; notice(error.message); }
};

function updateContextHint() {
  if (!config.limits) return;
  const l = config.limits, bytes = new Blob([$('task').value]).size;
  const warning = bytes + l.localOutput + 1300 > l.localContext;
  $('context-hint').textContent = `${warning ? 'Task may exceed the local budget. ' : ''}Local context ${l.localContext.toLocaleString()} · output reserve ${l.localOutput.toLocaleString()} · up to ${l.maxChunks} source chunks per worker. PDF text is checked/chunked, not silently truncated. Estimates are conservative UTF-8 byte units, not exact tokens.`;
  $('context-hint').classList.toggle('context-warning', warning);
}
$('task').addEventListener('input', updateContextHint);
async function showDiagnostics() {
  $('diagnostics-content').textContent = 'Checking the Relay server and its local Ollama runtime…'; $('diagnostics-refresh').disabled = true;
  try {
    const response = await fetch('/api/diagnostics'); const d = await response.json(); if (!response.ok) throw new Error(d.error || 'Diagnostics unavailable.');
    $('diagnostics-content').replaceChildren();
    const heading = document.createElement('p'); heading.textContent = d.scope; $('diagnostics-content').append(heading);
    const gib = value => typeof value === 'number' ? `${(value / 1024 ** 3).toFixed(1)} GiB` : 'Not available';
    const rows = [['System', `${d.system.platform} / ${d.system.architecture} · Node ${d.system.node}`], ['Available CPU threads', d.system.cpuThreads], ['OS-reported RAM / free', `${gib(d.system.totalMemoryBytes)} / ${gib(d.system.freeMemoryBytes)}`], ['Process-available memory', gib(d.system.processAvailableMemoryBytes)], ['Ollama', `${d.runtime.connected ? 'Connected' : 'Not connected'} · ${d.runtime.version || 'version unavailable'} · ${d.runtime.modelCount} installed models`], ['Local context / output', `${d.limits.localContext} / ${d.limits.localOutput}`], ['PDF extraction', `${d.limits.pdfTimeoutMs / 1000}s timeout · ${d.limits.pdfHeapMb} MB old-generation JS heap cap`]];
    const dl = document.createElement('dl'); dl.className = 'diagnostics-grid';
    rows.forEach(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = String(value); dl.append(dt, dd); }); $('diagnostics-content').append(dl);
    const list = document.createElement('ul');
    d.runtime.models.forEach(model => { const li = document.createElement('li'); li.textContent = `${model.name} · disk size ${gib(model.sizeBytes)}`; list.append(li); }); $('diagnostics-content').append(list);
    for (const message of [d.runtime.message, ...d.warnings]) { const p = document.createElement('p'); p.className = 'diagnostic-warning'; p.textContent = message; $('diagnostics-content').append(p); }
  } catch (error) { $('diagnostics-content').textContent = error.message || 'Diagnostics unavailable.'; }
  finally { $('diagnostics-refresh').disabled = false; }
}
$('diagnostics-button').onclick = () => { $('diagnostics-dialog').showModal(); return showDiagnostics(); };
$('diagnostics-refresh').onclick = showDiagnostics;
