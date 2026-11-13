# Relay — two local AIs, one optional Brain

Relay is a local-first AI workspace. Run it on the same PC as your installed **Ollama** models, choose two local production workers, and optionally add one cloud Brain using your own API key.

**Current release: source-distributed local browser app. Not a native/signed desktop installer or a finished public release.** Other runtimes (LM Studio, llama.cpp, standalone GGUF files) are not connected yet; models must be installed through Ollama for this release.

## Start on your PC

Prerequisites: Node.js 22+, npm, Ollama, and enough RAM/VRAM for your chosen models. Download/extract this project first and open a terminal **inside that project folder**. These commands use the downloaded code; no published npm package or installer is assumed.

If Ollama is not already running, start it in a separate terminal (or open the Ollama desktop app):

```sh
ollama serve
```

Check existing downloaded models:

```sh
ollama list
```

If you need two models, optional examples are:

```sh
ollama pull llama3.2:3b
ollama pull qwen2.5:3b
```

Downloads require internet, disk space and sufficient hardware. You can select your own two installed models instead. The app does not download models or execute setup commands for you.

In the Relay project terminal, paste:

```sh
npm ci
npm run local
```

Open **http://127.0.0.1:3000** in your browser, click **Refresh models**, then select a model in each production slot. Keep the terminal open; Ctrl+C stops Relay. Local launch binds to loopback and rejects non-local Host headers. Do not expose Ollama or Relay to the internet, change Ollama CORS, or open firewall ports.

For later launches only `npm run local` is needed. Copy `.env.example` to `.env` only if changing configuration. `OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434` and permits loopback HTTP addresses only; it is not a browser-supplied URL.

**Hosted preview limitation:** the backend connects to Ollama on the machine running Relay, not the machine displaying the browser. The Arena preview therefore cannot discover models on your PC. Download/run the project locally for that connection.

## Workflow

### Without a Brain — no cloud model API key

Enter a task, optionally upload a text PDF, select two different installed Ollama models and run Compare. Both receive the brief independently. No cloud model is called by Relay in this mode. Workers need no API keys. Models may be queued or loaded/unloaded by Ollama depending on hardware.

### With an optional Brain — BYOK only

1. Choose Brain mode and one cloud Brain model (OpenAI, Anthropic or Google).
2. Enter your API key in **Brain API key** settings. There is no operator-key fallback.
3. Select your two local workers, upload a PDF if needed, and choose **separate answers** or **one combined report**.
4. Generate a plan. Only the Brain runs at this stage.
5. Review/edit the two assignments and explicitly approve them.
6. Local workers execute. Combined mode adds one cloud Brain synthesis call; separate mode does not.

Original worker responses remain inspectable under the combined report and in Markdown exports. Failed workers are not hidden. If both fail, synthesis is skipped.

**Privacy and billing:** Brain mode sends your task, extracted PDF text, model names/assignments, and (for synthesis) worker outputs to your chosen cloud provider. That provider bills your API usage. Local workers have no provider API fee, but use local hardware/electricity. Consumer chatbot subscriptions generally do not include API usage. Keys stay in browser memory and are sent to the local server for calls, not written to disk, browser storage or application logs by Relay. Refreshing clears session keys; saved runs remain on disk until deleted or rotated by retention. Brain mode is not fully offline.

## Implemented

- Exactly two local-only production slots, with installed-model discovery and an explicit offline/empty state.
- Optional single BYOK cloud Brain, validated two-assignment planning, editable approval and synthesis.
- PDF text extraction with page labels (10 MB / 50 pages / 100,000 extracted UTF-8 bytes). Scanned PDFs need future OCR.
- Independent local responses, combined report option in Brain mode, per-model failures, usage metadata, Markdown export.
- Saved run library on disk: tasks, assignments, outputs and document metadata. Reopen and delete records from Saved runs. Retains 100 recent records plus any active runs; API keys and raw PDF files/context are excluded.
- Plans held without keys in bounded, expiring server memory; 30-minute lifetime, discard, concurrent-capacity reservations and single-use execution. Output selection is stored with the plan and cannot be changed at execution.
- 90-second cloud-call / 5-minute local-call timeout, bounded output, maximum three concurrent runs. Timeout/disconnect does not guarantee an Ollama job stopped internally. There are no automatic retries. Stage progress and Cancel run are available during model work. Cancellation aborts Relay requests, not a guarantee of runtime termination or charge reversal.
- Same-origin mutation token, plain-text response rendering, local-launch Host guard.
- Manual MCP workspace foundation described below.

The input is a task composer, not persistent multi-turn chat. Saved run history is not yet named project folders or resumable plan execution. Citations are model-generated and need verification. Local context defaults to 8192 with a 1024-token output reserve. Page-aware byte-budget chunking and bounded local map/reduce are implemented. Estimates are conservative UTF-8 byte units, not exact model tokens or a guarantee that the selected model supports the configured context. Chunk limits fail explicitly; source text is not silently sliced. Summaries remain lossy/model-generated.

## MCP workspace

The official MCP SDK host starts a bundled server via stdio, discovers tools and supports manual `list_files`, `read_file`, and explicitly approved `create_file`. Models do not invoke tools automatically.

Files live in Git-ignored `.relay-workspace/` on the machine running Relay. Flat names only, text up to 32 KB, maximum 200 created files, no overwrite, no shell and no arbitrary MCP launch commands. Traversal and final-component symlink reads are blocked on the tested Linux runtime. Keep the workspace and ancestors operator-owned and private; this is an application filesystem boundary, **not an OS/container sandbox**. Cross-platform filesystem/installer validation remains pending.

## Development and checks

```sh
npm ci
npm test
npm run dev
```

`npm start` / `npm run dev` bind to `0.0.0.0` for the development preview. **Use `npm run local` for PC use.** The single-user app has no login; the mutation token is not user authentication. Never deploy it as a public multi-user service without authentication, isolation and quotas.

89 tests cover cloud adapter errors, BYOK-only Brain calls, plan approval and execution lifecycle, both output modes, local discovery/inference with a test Ollama HTTP service, cloud-worker rejection, offline UI and DOM approval flow, actual PDF extraction, and real MCP handshake/file safety. Local inference is tested against a protocol-compatible test service, not real model weights. Live provider/hardware and real-browser visual/accessibility tests remain outstanding. `npm audit --omit=dev` reported no known vulnerabilities at the latest check; not a security guarantee.

## Remaining milestones

1. Real-PC Ollama testing on Windows/macOS/Linux; hardware fit, context capability and chunked answer-quality validation. Diagnostics and explicit context/chunk controls are implemented.
2. Native installer/packaging, signing, updates and installation/uninstallation tests.
3. Named local projects/resumable plans, token streaming, budgets, bounded iterative review and explicit retry controls. Saved runs, stage progress and request cancellation are implemented.
4. Permissioned model-driven MCP, trusted external MCP connections, OS-isolated command execution, background-process lifecycle and audit history.
5. Authentication/user isolation if adding hosted multi-user access; OS-level PDF isolation/security review, monitoring, privacy/retention policy, beta and launch.

See `docs/DOCUMENT-HARDWARE-MILESTONE.md` for the latest milestone and `docs/REAL-PC-CHECKLIST.md` for the manual gate; `docs/RELIABILITY-AUDIT.md` covers the preceding audit; `docs/RELIABILITY-MILESTONE.md` describes the milestone; `docs/BUG-HUNT-REPORT.md` describes the preceding audit; `docs/STATUS-REPORT.md` retains implementation history.

### Latest audit notes

Model refresh now locks task submission until it finishes. Malformed runtime entries no longer hide valid models. Closed MCP connections are recreated on the next request. Oversized JSON returns 413 and malformed JSON returns a fixed error without reflecting request contents. The launcher prints the actual bound port only after readiness and reports port conflicts. Workspace names exclude Windows device names and trailing dots. These checks do not replace actual cross-platform testing.

## Saved runs, progress and cancellation

Run history is stored as atomic-replacement JSON records in `.relay-data/history/` (Git-ignored), or under `RELAY_DATA_DIR/history/`. Protect this private directory: records are **not encrypted**, and prompts, assignments and outputs may contain sensitive content even though credential fields are excluded. Saving uses an explicit field allowlist; do not paste secrets into task text. Original PDF bytes/extracted full context are not retained, but model outputs may quote them. Deletion removes the history record, not exports, cloud-provider records, backups or a pending in-memory plan.

On startup, records that were running/cancelling are marked **interrupted**. Partial worker responses already recorded remain inspectable; nothing is automatically rerun. Pending Brain approval and full PDF context are not restored. Generate a fresh plan and upload the document again if needed.

Local Ollama responses are read incrementally as NDJSON. Worker A/B live drafts refresh through one-second read-only status polling (not browser push/SSE). PDF drafts show the current local call, not the final whole-document report. Brain planning and cloud synthesis remain non-streaming. Partial checkpoints are persisted at most once per 1.5 seconds per worker during generation, plus stage/final saves; sudden shutdown can lose recent uncheckpointed tokens. Cancel run aborts pending fetches and prevents starting Brain synthesis after cancellation is observed. A provider/Ollama may continue work already accepted; cancellation does not guarantee zero further computation or charges. The UI waits for the request to settle. On a cancelled Brain execution, inspect Saved runs for partial responses.

History saving failures produce an export warning in successful run responses, rather than discarding otherwise useful model results. A maximum 2 MB JSON record is enforced; the directory should be used by one Relay process at a time. No database-level multi-process locking or encrypted backups are provided.

API additions: `GET /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`, `POST /api/runs/:id/delete`. Mutation routes require the workspace token. Model requests may include `X-Relay-Run` (UUID) for progress correlation; duplicate run IDs are rejected, not replayed.

### Saved-run audit update

History reads now validate record structure, enforce the 2 MB limit before loading, match the file ID to the stored ID, and reject symlink reads on the tested Linux system. Damaged records are skipped with an inline warning and left on disk for manual recovery. Writes use uniquely named exclusive temporary files rather than a predictable `.tmp` target. Directory/ancestor ownership must still be trusted; no cross-process locking, encrypted storage or power-failure fsync guarantee is provided.

Completed run states are immutable. Partial results preserve worker slot identity; workflows with a failed worker or failed synthesis are marked `partial`, not `completed`. Approval records become `plan_expired` after a server restart because their document context is not restored. A rejected run registration no longer consumes an approved plan. Consumed/uncertain executions are not resubmitted by the UI; it attempts read-only recovery and directs the user to Saved runs, where active runs can also be cancelled.

## Diagnostics and document/context settings

Click **Diagnostics** beside the local connection panel. It reports the server machine (sandbox in the hosted preview), not necessarily the browser's computer. It does not measure GPU/VRAM or certify model fit. Model disk size is not runtime memory usage.

Set limits in `.env`, restart Relay, then refresh the page:

```ini
RELAY_LOCAL_CONTEXT=8192
RELAY_LOCAL_OUTPUT=1024
RELAY_BRAIN_CONTEXT=128000
RELAY_MAX_CHUNKS=12
RELAY_PDF_TIMEOUT_MS=15000
RELAY_PDF_HEAP_MB=128
```

Larger contexts can increase RAM/VRAM use. Use the lowest supported context across the two workers. PDFs are processed by a cancellable worker with a wall timeout and V8 heap cap; these are **not an OS sandbox or total-RSS bounds**. Large documents may trigger multiple bounded local map/reduce calls per worker. Every chunk must complete or the result is marked incomplete; cloud Brain calls do not automatically expand into paid map/reduce loops. See the milestone report for ranges, cancellation/memory limitations and testing scope.

Latest bug hunt: `docs/POST-MILESTONE-BUG-HUNT.md` — output-limit detection, partial document evidence/accounting, direct Brain cancellation propagation and transparent partial-result exports; 77 regression tests passing.

Local streaming milestone: `docs/LOCAL-STREAMING-MILESTONE.md` — 89 tests passing. Live drafts are incomplete until the worker finishes; no automatic replay on disconnect or restart.
