# Relay — post-milestone bug hunt and phase plan

Date: 2026-11-09
Scope: document/hardware milestone, model adapters, document reduction, cancellation, result presentation and exports. This is a targeted code/test audit, not penetration testing or real-hardware certification.

## Executive result

**77/77 automated tests pass**, up from 68. Five newly added regression tests failed before the fixes and passed afterwards; four further tests guard UI/export transparency, cancellation evidence, cross-page ordering and pre-cancelled PDF work. No automatic retries, operator-key fallback or new paid call loops were introduced.

The implementation is a development alpha. The bounded PDF/context pipeline is implemented and regression-tested, but real Ollama weights, GPU behavior, live cloud accounts and native platform validation remain release gates.

## Fixed problems

| Finding | Impact before the fix | Fix and regression evidence |
|---|---|---|
| Ollama output-limit termination counted as success | A cut-off answer or chunk summary could be labelled complete and used as successful evidence | Detect `done_reason: length`; return an explicit incomplete/error result while retaining partial text and usage. Dedicated adapter test. |
| Cloud output-limit termination counted as success | OpenAI, Anthropic or Google could return a cut-off report that Relay displayed as completed | Handle OpenAI `finish_reason: length`, Anthropic `stop_reason: max_tokens` and Google `finishReason: MAX_TOKENS`. Keep partial text; do not retry. One test exercises all three adapters with protocol fixtures. |
| Failed document chunks discarded their own partial output and processing counts | Useful text from the failing chunk disappeared, particularly when the first chunk failed; chunk/call counts and aggregate usage were missing on failures | Centralized incomplete-result construction preserves prior map findings, the failing response's text, source-chunk count, attempted call count and accumulated usage. Regression reproduces first-chunk failure. |
| Failed reduction discarded its own partial synthesis | Users could inspect map findings but not the available portion of the failed synthesis; accounting was lost | Retain both map evidence and partial synthesis, identify the synthesis failure, preserve accounting, and never classify it as whole-document success. Regression reproduces reduction failure. |
| Brain executor did not forward its cancellation signal directly | The production route wrapper forwarded cancellation, but the executor's own signal contract was incomplete for direct calls/reuse | Pass `signal` explicitly to both local workers and cloud synthesis. A test checks all three invocations receive the same signal. |
| Partial answers concealed their failure reason in the UI/export | Rendering preferred `text` over `error`; exports could read like complete answers even when the model result was an error | Result cards show error reason and partial text together. Markdown includes run status and an `INCOMPLETE / ERROR` marker with the reason. A DOM/export test verifies both text and reason survive. |
| Cancellation lost document accounting | Evidence could survive cancellation without its chunk/call/usage metadata | Cancellation propagates a structured incomplete result through the local adapter. A regression cancels after one map result and verifies evidence, call count and usage. Runtime-may-continue warning remains visible. |

These fixes detect explicit output-limit signals; they do not prove that any model answer is factually complete. Providers/runtimes may vary in which completion metadata they return.

## Additional checks

- Cross-page chunking preserves the order and Unicode text of small, oversized and following pages within the byte budget.
- Already-aborted PDF extraction rejects before starting a worker.
- Existing real-PDF extraction, hung-worker deadline, cancellation, large-PDF HTTP workflow, history recovery, explicit Brain approval, BYOK-only behavior and manual MCP safety tests remain green.
- `npm audit`: **0 known vulnerabilities** at this check; not a security guarantee.
- `node --check`: all JavaScript files under server, public, scripts, test and test-support pass.
- `git diff --check`: passes. The working tree includes new untracked application files from the session; this Git command alone does not inspect their whitespace, so it is not a complete new-file validation.
- Inspected the existing preview process before restarting it. The updated homepage, diagnostics and saved-run endpoints each returned HTTP 200.
- No real model or paid provider was called for this audit. Adapter tests use mocked/protocol-compatible services. UI testing uses jsdom, not a full graphical browser.

## What remains incomplete

### Release gates — high priority

1. **Real-PC acceptance:** execute `docs/REAL-PC-CHECKLIST.md` with two installed models; record latency, queueing, load/unload behavior and actual memory pressure. Repeat on intended supported operating systems.
2. **Real provider acceptance:** test user-owned keys, quota/auth failures, planning and both output modes. Check actual provider billing/cancellation behavior. Do not store keys or publish them in evidence.
3. **Real-browser validation:** keyboard/accessibility, responsive layout, upload/drop behavior, tab closure/recovery, diagnostic dialog and exports. DOM tests are not visual acceptance.
4. **Model/context fit:** byte estimates are conservative, not real tokenizers or capability discovery. Confirm both selected models support configured context. GPU/VRAM is not measured; disk size is not RAM use.
5. **Hostile PDF isolation:** the worker has a deadline and V8 heap limits, not an OS sandbox or total-RSS/CPU quota. Native allocations and process-wide exhaustion remain risks. Test and isolate at OS level before broader deployment.

### Product work — not delivered yet

- Token-by-token streaming and independent live worker output/status.
- Named projects, resumable revisions and durable approval context. Saved run inspection exists; restart does not resume a plan.
- Cost estimates, user-defined budgets and explicit retry/revision controls. No automatic retry should be added implicitly.
- OCR for scanned PDFs and stronger document navigation/citation validation.
- Model-driven MCP orchestration. Current MCP is manual, bounded and approval-gated; arbitrary terminal/background application control is not implemented.
- Native installers, signing, secure updates and platform beta coverage.
- Authentication/isolation/quotas if hosted multi-user access is ever introduced. The current app remains single-user/local-first.

### Standing limitations

Summaries are lossy; citations need manual verification. Explicit input-budget checks cannot force a runtime to honor its requested context. Cancellation stops Relay from proceeding but cannot guarantee already accepted runtime/provider work or charges stop. History is plaintext and may contain sensitive outputs. File deletion does not erase exports, backups or provider records. History has no cross-process locking or guaranteed power-loss durability. No claim is made that this hunt found every defect.

## Next phase and work plan

### Phase A — real-PC baseline and streaming reliability

1. Run the manual checklist with two small local models before increasing context sizes. Capture non-sensitive environment/model/limit/latency evidence.
2. Implement local token streaming first with bounded buffers, incremental parsing and separate Worker A/B state.
3. Preserve the current explicit approval and single-use execution rules. Streaming must not start workers during planning or silently replay a failed request.
4. Persist only bounded partial checkpoints, not every token. Define interrupted/cancelled/error/completed event semantics; never overwrite a terminal state.
5. Add tests for split/malformed stream records, one worker failing while the other streams, output-limit completion, cancel mid-stream, lost client connection, late events, restart recovery and safe plain-text rendering.
6. Add real-browser coverage; then consider streaming cloud planning/synthesis without expanding paid calls.

**Exit criteria:** both workers visibly stream; cancellation settles without new downstream calls; partial results remain inspectable; reconnect/recovery never resubmits a consumed plan; explicit output-limit signals remain incomplete; existing regression suite stays green.

### Phase B — controlled workflows

Named projects/revisions, budget/cost display and user-requested bounded retries. Then introduce a small model-driven MCP loop with an allowlist, visible tool requests, explicit write approval, call/time/output budgets and an audit trail. Do not jump straight to unrestricted terminal or background-app control.

### Phase C — distribution readiness

OS-level isolation/security review, platform-specific acceptance, installers/signing/updates and a small private beta. Multi-user hosting requires a separate authentication/isolation design, not just exposing the current preview.

## Related reports

- `docs/DOCUMENT-HARDWARE-MILESTONE.md` — previous milestone implementation and boundaries.
- `docs/REAL-PC-CHECKLIST.md` — unexecuted real-hardware acceptance gate.
- `docs/RELIABILITY-AUDIT.md` — preceding 52-test audit, retained as historical evidence.
