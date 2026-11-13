# Relay — real-PC validation checklist

Status: **prepared, not executed on real user hardware.** Do not treat sandbox/mock results as a completed Windows/macOS/Linux certification.

## Setup

- Install Node.js 22+ and Ollama. Download/extract the project and open a terminal there.
- Run `ollama list`; confirm at least two different local models are installed. Use small models first.
- Start the Ollama app, or `ollama serve` in another terminal if it is not running.
- Run `npm ci`, then `npm run local`. Open the printed localhost URL. Do not expose ports or change Ollama CORS.
- Open Diagnostics. Record OS/architecture, runtime version, model names and free RAM. GPU/VRAM fit must be checked separately; OS RAM is not a model-fit promise.
- Keep prompts/documents non-sensitive during validation. Never include API keys in screenshots, reports or task text.

## Local-only acceptance

- [ ] Both model slots list installed local models, not cloud models.
- [ ] A short task runs with no Brain key.
- [ ] A small text PDF gives answers with page references; manually verify at least two references.
- [ ] A longer PDF triggers chunk progress and each result shows chunk/call counts.
- [ ] A document over the configured chunk limit fails explicitly rather than dropping pages.
- [ ] A scanned or empty-text PDF explains the OCR limitation.
- [ ] A malformed/encrypted PDF fails without breaking the app; a subsequent valid PDF still works.
- [ ] Cancel during extraction, during local generation and between chunks. Observe Relay stops proceeding; separately check whether Ollama continues work internally.
- [ ] Stop Ollama mid-run. Inspect failed/partial outcomes, then restart Ollama and refresh models.
- [ ] Test while memory-constrained without risking unsaved work in other apps. Record queueing/loading behavior; do not deliberately exhaust system memory.

## Optional Brain acceptance (provider charges apply)

Use your own authorized provider key through Brain API key settings. No key should be pasted into a task, terminal report or source file.

- [ ] Planning runs once and workers do not start before approval.
- [ ] Edit both assignments; approval resets.
- [ ] Separate output runs local workers without a synthesis cloud call.
- [ ] Combined output adds one Brain synthesis call and retains original worker responses.
- [ ] Cancel before/during synthesis; inspect the provider account separately for charges. Cancellation cannot reverse accepted work.
- [ ] An invalid key/insufficient quota produces a useful error, with no fabricated result.
- [ ] A task over the configured Brain context cap is rejected before a cloud request.

## Persistence/recovery

- [ ] Reopen a completed run after browser refresh and server restart.
- [ ] API keys are cleared on refresh; tasks/outputs remain in Saved runs until deleted/retained out.
- [ ] Close the tab during work, reopen Saved runs, and cancel the active run there if desired.
- [ ] Stop Relay during a run; restart and verify interrupted status with recorded partial worker results, no automatic replay.
- [ ] Restart after creating a plan: the old record is expired and needs a fresh upload/plan, not hidden execution.
- [ ] Delete a saved run. Confirm its JSON record is removed; exported files/provider records are not deleted.

## Evidence to record (no secrets)

OS/architecture, Node and Ollama versions, selected model names/sizes, configured context/output/chunk limits, PDF page count, approximate task length, elapsed time, completed/partial/cancelled status and observed cancellation/runtime behavior. Record a pass/fail per checkbox and reproduction steps for failures. Do not collect hostname, user directory, keys, private document text or prompt contents by default.

Run this checklist on each intended supported platform before claiming installation or runtime support. Native installers, signing/updating and multi-process data locking are not delivered yet.
