# Relay — implementation and bug-hunt report

## Overall status
Not complete. This is a single-user development alpha: a Phase 1 Compare workspace with an early, deliberately scoped Phase 3 MCP foundation. It is not ready for public multi-user launch.

## Before this audit
Implemented: task input, optional PDF, two model selectors, three provider adapters, session-only BYOK, independent outputs, per-model errors, session history and Markdown export.
Missing: MCP, Brain execution, Divide mode, merged results, background app control, persistent projects, authentication and production quotas.

## Fixes made
1. **Valid PDFs rejected:** reproduced with a PDFKit-generated document. Replaced old pdf-parse engine with PDF.js; real upload now extracts successfully. Page and text limits enforced during extraction; document resources destroyed afterward.
2. **Concurrency released too early:** a browser disconnect previously freed its slot before provider calls finished. Slot now remains occupied until handler completion, with cleanup for upload errors.
3. **No mutation request guard:** added process-scoped token validation on POST API calls and updated clients. This prevents ordinary cross-site form requests, not unauthorized users who can access the app.
4. **Inherited provider names:** replaced prototype-chain lookup with own-property validation for BYOK provider keys.
5. **Stale results:** previous results are hidden while a new comparison runs. Saving different keys during a run is blocked.

## MCP added
Real official-SDK MCP host/client and bundled server over stdio. UI supports discovery, file listing, reading text, and explicitly approved creation. Workspace files persist in the Git-ignored server workspace folder.

Safeguards: simple flat filenames, no traversal, no final-component symlink reads, regular-file checks, bounded reads/writes, create-only writes, no overwrites, 200-file creation cap, serialized host tool calls, minimal child environment, fixed tool allowlist. Approval resets when filename/content changes or a call completes.

This is NOT arbitrary computer access, an OS sandbox, automated model tool usage, remote MCP configuration, a CLI agent, or desktop automation. No shell commands or background apps are enabled. Trusted operators must keep the workspace directory and its ancestors private and stable. Current approval is single-user application approval, not a multi-user authorization system.

## Verification
- 13 automated tests pass.
- Integration tests launch an actual HTTP server and actual MCP subprocess.
- Real PDF generation/extraction and fake-PDF rejection tested.
- Real MCP discovery, round-trip file operations, approval denial, overwrite denial, traversal, symlink and size rejection tested.
- Unit tests cover adapter normalization, safe errors and independent failures.
- npm audit reports 0 known dependency vulnerabilities at time of check (not a security guarantee).
- JavaScript syntax and patch whitespace checks pass.
- No browser automation or live provider calls verified in this audit.

## Remaining work
Priority 1: authentication, per-user isolation/quotas, resource-isolated PDF extraction, provider live testing, browser/accessibility testing, cancellation, robust run persistence and retention.
Priority 2: Divide mode, BYOK-only Brain with no operator-key fallback, plan approval, bounded review and merged output.
Priority 3: model tool-calling loop with permissions and audit trail, trusted external MCP integrations, isolated agent execution and background-process lifecycle controls.

Brain BYOK is a requirement, not an implemented execution feature. Users pay their provider for model usage; hosting is separate.

## Update — Brain workflow milestone

This update supersedes earlier statements above that Brain execution and combined output are missing.

Implemented:
- Brain mode with BYOK-only planning and synthesis; no operator-key fallback for either call.
- Brain and two worker selectors beside the task input; responsive stacking on small screens.
- Shared PDF extraction for Compare and Brain planning.
- Structured, validated two-assignment plan with editable instructions and explicit approval.
- Server-held plan context, no stored keys, 30-minute expiry, bounded plan storage, single-use execution and discard.
- Concurrent worker execution; separate answers or one Brain-synthesized report. Worker failures stay visible; both failures skip synthesis.
- Original worker responses preserved under combined reports, plus Markdown export and session history.
- Locked task/model/document/output selection while a plan is pending; editing assignments resets approval.

Verification: 20 automated tests pass. Added coverage for BYOK-only enforcement despite an operator key, malformed plans, both output modes, partial/all-worker failures, no execution before approval, edited assignments, discard and single-use plans. A jsdom UI test exercises selectors, keys, planning, approval, execution and safe rendering. This is DOM testing, not a real-browser visual/accessibility test. Existing real PDF/MCP integration tests pass. Live provider calls remain unverified.

Still missing: durable multi-user projects, authentication, cancellation/streaming, budgets, iterative review, autonomous MCP tool calling, external MCP servers, shell execution and background app control. The current interface is a task composer, not persisted multi-turn chat. Remains a single-user development alpha.

## Latest update — local-first product direction

This update supersedes previous cloud-worker assumptions. The two production slots are now **local Ollama models only**, and the single cloud Brain is optional and BYOK-only. Compare does not require API keys. Cloud-worker submissions are refused by the server. Brain planning/approval/synthesis remains implemented, now coordinating local workers.

Added: installed model discovery, local inference adapter with a 5-minute timeout, offline/empty connection state, refresh action, in-app terminal setup instructions, copyable local start commands, loopback-only `npm run local` launcher and local Host-header guard. Ollama endpoint is operator-configured loopback HTTP only; redirects are disabled. No cloud keys are sent in local inference requests. Obvious remote/cloud Ollama entries are excluded from discovery. Approved plans retain their local model descriptors across connection refreshes.

Install flow today: download/extract source, install Node.js and Ollama, start Ollama, verify/download two models, then paste `npm ci` and `npm run local` in the project terminal. Open localhost in the browser. This is **not** a downloadable signed desktop installer, a published npm package, a remote tunnel, or a universal connector for every local runtime. The hosted preview cannot see a user's PC.

Verification: 27 tests pass, including discovery/inference against a protocol-compatible local test HTTP server, no-key worker execution, refusal of cloud production workers, offline UI, endpoint restrictions and the prior Brain/PDF/MCP tests. Actual model weights, live Brain providers, Windows/macOS/Linux install behavior and hardware performance have not been verified. Dependency audit currently reports no known vulnerabilities.

Still outstanding: native installer/signing/updating, durable projects, cancellation/streaming, context chunking, budget/revision controls, autonomous MCP, shell/background app execution, production security and beta/launch validation. Broad “all remaining work” is not claimed complete. See current README for accurate setup and privacy details.

## Latest audit

See `docs/BUG-HUNT-REPORT.md` for the current nine-group fix report and next-phase plan. Suite now contains 35 passing tests. Current readiness remains local-first development alpha; this does not supersede the documented live-provider, real-model, cross-platform and release-validation limitations.

## Reliability milestone update

See `docs/RELIABILITY-MILESTONE.md`. Saved disk-backed runs, restart-interrupted recovery, stage progress and request cancellation are now implemented; 42 tests pass. Previous statements that all history is tab-only or that cancellation is entirely missing are superseded. This remains a local-first alpha without named projects, token streaming, native installers or verified real-model/cross-platform behavior.

## Latest reliability audit

See `docs/RELIABILITY-AUDIT.md` for the current report. 52 tests pass. New fixes cover malformed history, bounded/safe persistence, immutable terminal states, worker-slot identity, plan-registration failure, uncertain execution recovery, accurate partial/expired statuses and visible history errors. Previous reports are historical snapshots; local-first development-alpha limitations remain in effect.

## Document/hardware milestone

See `docs/DOCUMENT-HARDWARE-MILESTONE.md` and `docs/REAL-PC-CHECKLIST.md`. Diagnostics, explicit conservative context budgets, page-aware bounded local map/reduce and PDF worker extraction with timeout/heap/cancellation controls are implemented. 68 tests pass. Earlier statements that context chunking or worker extraction are entirely absent are superseded. OS-level isolation, actual hardware/provider validation, token streaming and native distribution remain outstanding.

## Post-milestone bug hunt (2026-11-09)

See `docs/POST-MILESTONE-BUG-HUNT.md`. 77/77 tests pass (previous milestone: 68). Fixed explicit local/cloud output-limit responses incorrectly classified as success, lost failed-chunk/reduction partials and accounting, direct Brain executor signal forwarding, hidden error reasons in partial cards/exports, and cancelled-document accounting. Hardware/provider/full-browser acceptance remains outstanding. Next: real-PC baseline plus bounded local streaming, then controlled workflows and distribution gates.

## Local streaming implementation

See `docs/LOCAL-STREAMING-MILESTONE.md`. Local adapters now consume bounded Ollama NDJSON with live per-worker drafts and throttled durable checkpoints. Browser display refreshes through existing one-second read-only polling, not SSE. Cloud Brain remains non-streaming. 89 tests pass, including a real HTTP delayed-stream/progress/finalization test against a test Ollama service. Real weights/provider/browser/platform acceptance remains unexecuted.
