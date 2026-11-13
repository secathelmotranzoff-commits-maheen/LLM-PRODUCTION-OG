# Reliability milestone — saved runs, progress and cancellation

## Delivered

- Disk-backed saved run library with explicit open/delete UI.
- Atomic-replacement JSON records; private directory/file modes on the tested Linux system.
- Explicit storage field allowlist: no API-key objects, request headers, raw PDF bytes or full extracted context. Tasks/outputs can still contain sensitive text; data is not encrypted.
- Last 100 records retained, with active work protected from retention deletion. Per-record 2 MB limit.
- Restart recovery: running/cancelling records become interrupted; recorded worker results remain available. No automatic execution/retry.
- Stage progress for document extraction, Brain planning, local workers and synthesis, using status polling.
- Cancel button backed by AbortController signals through local and cloud adapters.
- No synthesis started after cancellation is observed; previously recorded worker results retained.
- Active-run deletion denied. Duplicate run IDs rejected, including simultaneous submissions.
- User-visible history-save warning if persistence fails, instead of losing completed model outputs.

## Meaning of cancellation

Relay aborts its pending network requests and stops proceeding to later work once cancellation is observed. Ollama or a cloud provider may continue a job already accepted. This does not guarantee a process was killed or charges stopped. Requests are never automatically retried. CPU-bound PDF parsing is still in-process and is not immediately interruptible.

## Meaning of recovery

The run library preserves results across tab/server restarts. It is not yet a full named-project system. Approval state, API keys and full PDF context are deliberately not restored. Old plan records can be read, but execution requires a newly generated plan and explicit approval. Closing a tab does not cancel server-side work automatically.

## Verification

**42 automated tests pass**, including:
- Disk reopen/read/delete and absence of credential/full-document fields in records.
- Interrupted-state recovery with partial results.
- Retention, invalid paths and duplicate run IDs.
- Cancellation preventing synthesis and retaining partial results.
- Simulated persistence failure warning.
- Actual HTTP start/progress/cancel/settle/read/delete cycle against a test local-runtime server.
- Saved-run UI open/delete flow in jsdom.
- All prior Brain/PDF/MCP/local-discovery/security regression tests.

`npm audit`: zero known vulnerabilities at the latest check. Syntax and whitespace checks pass. Real weights, live providers, Windows/macOS install behavior and real-browser visuals remain unverified. Existing PDF.js headless rendering warnings do not break tested text extraction.

## Storage and privacy

Default `.relay-data/history/`, configurable with `RELAY_DATA_DIR`. Git-ignored. Plaintext private-user files, not encrypted storage. A user may include sensitive information in task text or a model may quote a PDF; exclusion of explicit key/PDF fields is not content redaction. Delete removes only a saved record—not exports, cloud records/backups or a pending plan in memory. Use one Relay process per data directory; cross-process locking and crash/power-failure fsync guarantees are not implemented.

## Remaining work in this reliability phase

1. Real-PC validation with two installed Ollama models and a BYOK Brain; measure RAM/VRAM behavior and queueing.
2. Token-aware document chunking/context controls and resource-isolated PDF parsing.
3. Token streaming, richer per-worker live state and cancellation checks across provider/runtime behavior.
4. Named project organization, draft retention and deliberate plan-resumption design without saving keys.
5. Real-browser/accessibility and Windows/macOS/Linux filesystem/launcher tests.

After those gates: permissioned model-driven MCP, then native installer/signing/update work and beta validation. No unrestricted shell or background-app access was added in this milestone.
