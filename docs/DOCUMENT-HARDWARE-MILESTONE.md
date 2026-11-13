# Document and hardware reliability milestone

## Implemented

### Diagnostics

A Diagnostics dialog and `GET /api/diagnostics` show the **Relay server's** OS/architecture, Node version, available CPU threads, reported RAM, Ollama connection/version, installed model names/disk sizes and configured limits. No hostname, username, user path, API key, task or PDF content is collected by this endpoint.

The hosted preview reports sandbox resources, not the browser device. GPU/VRAM and model fit are unmeasured; container limits can differ from OS RAM. No model inference or cloud call is made by diagnostics.

### Explicit context budgets

Defaults: local context 8192, local output 1024, Brain context 128000, 12 source chunks per worker. All validated at startup and configurable through `.env`. `RELAY_LOCAL_CONTEXT` range 4096–131072; local output 128–2048; Brain context 8192–1000000; source chunks 1–32. A 512-unit safety margin is reserved.

Estimation deliberately uses UTF-8 bytes as conservative token units. This is not a model/provider tokenizer or a mathematical fit guarantee. The app checks prompts before sending them and rejects excess rather than slicing strings. The selected model/runtime must actually support the configured context; no capability auto-detection is claimed.

### Page-aware local document processing

Extracted pages remain structured with original page labels. Large pages split on Unicode code-point boundaries without dropping source characters. Adjacent fragments are grouped into bounded inputs. Each local worker maps relevant findings per chunk, then performs bounded hierarchical synthesis with citation/uncertainty instructions. The original user task and approved assignment are included.

Every source chunk must complete for a successful whole-document result. Failures return explicit incomplete analysis; map outputs already produced are retained when available. Reduction is limited to 6 rounds and at most `3 * RELAY_MAX_CHUNKS + 4` calls per worker. Source chunks default to 12 maximum. Limits fail explicitly; no automatic source-page omission. Chunked processing makes extra local calls and can be slower. Summarization is lossy and model-generated, not a claim of verified citation accuracy.

Brain planning/synthesis still receives full extracted source context, subject to its own configured cap. There is no cloud map/reduce expansion or hidden extra Brain call. Oversized Brain prompts fail before the request. Real provider usage can still incur charges for valid requests.

### Worker-isolated PDF extraction

PDF.js now runs in a short-lived Node worker, receives only PDF bytes and a minimal environment, and is terminated on completion, failure, timeout or cancellation. Defaults: 15 seconds wall time and a 128 MB V8 old-generation heap cap. PDF limits remain 10 MB / 50 pages; extracted text is now limited to **100,000 UTF-8 bytes**, not characters.

This separates parsing from the main event loop and makes extraction cancellation effective. **It is not an OS sandbox, CPU quota or total-memory limit.** Buffers/native allocations and total RSS are not fully bounded by V8 resourceLimits. Real-world memory-exhaustion behavior remains unverified. The worker retains the process user's filesystem/network privileges. Keep this single-user app private and use OS-level isolation before broader untrusted deployment.

## Verification

68 automated tests pass. New coverage includes Unicode/source preservation and byte budgets, chunk-cap failure, local/Brain budget rejection before network calls, map/reduce completion/failure/cancellation, diagnostics scope/privacy/offline status, actual PDF extraction and blank-text rejection in a worker, real hung-worker termination, worker cancellation, and an HTTP large-PDF workflow through real extraction and a test Ollama service. The diagnostics UI is tested in jsdom.

`npm audit` reports 0 known vulnerabilities. Syntax/whitespace checks pass. Real model weights, GPU behavior, live cloud providers and Windows/macOS installations remain unverified. Actual V8 OOM stress was not attempted; tests verify configured worker limits and timeout/cancellation behavior. PDF.js headless rendering warnings can still appear during extraction; page rendering is not implemented.

## Real-PC gate and next work

`docs/REAL-PC-CHECKLIST.md` is ready for use, but not executed on a real user's PC. Run it with two small installed models before increasing context sizes or claiming platform compatibility.

Next implementation: true token streaming, per-worker live state and real-browser end-to-end testing. Then named projects/budgets/revisions, controlled model-driven MCP, desktop packaging/signing/updating and beta validation. Native installers and autonomous terminal/background-app control are not part of this milestone.
