# Relay — saved-run and cancellation bug-hunt report

## Summary

**Current product:** two local Ollama production models, one optional BYOK cloud Brain, PDF tasks, approved assignments, separate/combined output, saved runs, stage progress, request cancellation and manual MCP file tools.

**Readiness:** local-first development alpha, not a finished desktop release.

This audit focused on the newly added persistence/lifecycle paths. The suite increased from **42 to 52 passing tests**. Two regressions were reproduced before fixes: a malformed saved result object crashed history listing, and late updates/duplicate completion overwrote a completed run. Other findings were identified through code-path inspection and verified with targeted regressions after repair.

## Fixed in this audit

| Area | Problem | Change and verification |
|---|---|---|
| History resilience | One valid-JSON but malformed record could break the entire list and startup recovery. Unbounded reads also bypassed the write-size limit. | Validate persisted fields/results/plans, enforce 2 MB on reads, check filename/content ID agreement, read sequentially, skip invalid records with a warning. Healthy records remain available; bad files are retained for manual recovery. |
| File safety | Predictable `.json.tmp` writes could follow a leftover symlink; direct history reads followed links. | Unique exclusive temporary files with cleanup; regular-file and no-follow checks on reads. Linux regressions verify oversized/mismatched/symlink rejection and that a predictable leftover temp link is not followed. This is defense in depth, not a sandbox or a Windows security certification. |
| Lifecycle finality | A late update or repeated finish could change completed work to running/failed and overwrite saved results. | Ignore updates once finalization starts and return the same completion promise for repeat finishes. Regression verifies persisted final state stays unchanged. |
| Worker identity | Completion-order partial arrays could label Worker B as Worker A after cancellation. | Attach an explicit slot to results, sort progress snapshots by slot, persist the slot, and use it in UI/export labels. Regression makes B finish first and checks original identity. Legacy records without slots retain the positional fallback. |
| Plan consumption | Execution marked a plan consumed before run registration succeeded. A duplicate/invalid run ID could destroy an otherwise valid approved plan without starting workers. | Reserve the plan while registering; restore pending state on registration failure; consume only when execution starts. HTTP regression rejects registration then successfully submits the same plan with no early worker calls. |
| Execution uncertainty | After consumed/cancelled/unknown network outcomes, the UI kept showing approval for an unusable plan and did not recover recorded partial results. | Server errors disclose whether execution consumed the plan; UI clears consumed/uncertain approval, performs read-only run recovery and never automatically replays model requests. UI tests cover both explicit consumed failure and lost connection. Active saved runs have a Cancel action. |
| Outcome accuracy | A successful worker plus a failed worker—or successful workers with failed synthesis—could be called completed. Old plan-ready records stayed apparently ready after restart. | Use `partial` for mixed outcomes, `failed` when no worker succeeds, and `plan_expired` for approval contexts lost on restart. Classification and restart tests pass. |
| History error visibility | Offline fallback text was erased immediately, and errors were shown behind the dialog. | Dedicated inline status area preserves fallback/read/delete errors and damaged-record warnings. DOM regression checks visible offline status. |

Also restricted persisted token-usage values to finite non-negative numbers, and kept execution response timestamps consistent with saved run start times.

## Verification

- `npm test`: **52/52 passing**.
- `npm audit`: **0 known vulnerabilities** at this check, not a guarantee of security. Dependency deprecation warnings remain.
- JavaScript syntax checks and `git diff --check` pass.
- Existing actual HTTP/PDF/MCP/local-launcher tests continue passing.
- Local inference integration uses an Ollama-compatible test HTTP service, not downloaded weights.
- Cloud responses and Brain workflows are tested with mocks; live provider billing/model availability are unverified.
- UI tests use jsdom, not a full browser visual/accessibility suite.
- Filesystem checks ran on Linux. Windows/macOS behavior remains unverified.
- Headless PDF.js DOMMatrix/Path2D warnings remain; tested text extraction passes. Page rendering is not implemented.

## What remains to complete

### Core reliability gates — still open

1. Real-PC testing with two installed models: loading/queueing, RAM/VRAM pressure, runtime restarts and cancellation behavior.
2. Live BYOK Brain test in a provider-accessible environment with user-authorized keys.
3. Token/context-aware PDF handling and chunking; isolated resource-limited PDF parsing.
4. Token streaming and richer per-worker progress. Current progress is stage polling, not streaming.
5. Named local projects/drafts and a deliberate resumable-plan design. Saved run results persist, but approval/PDF context does not resume.
6. Real-browser accessibility/mobile checks, plus Windows/macOS/Linux setup and filesystem tests.

### Later planned capabilities

- Budgets, bounded review/revision loops and explicit user-controlled retries.
- Model-driven MCP with per-tool permissions, approvals and durable audit history.
- Trusted external MCP integrations and appropriate credential handling.
- OS-isolated command execution, coordinated file editing and background-process lifecycle controls.
- Native installers, signing, updates, uninstall and release packaging.
- Beta feedback, privacy/security review, documentation and support procedures.
- Authentication/user isolation/quotas if a hosted multi-user mode is introduced; not needed to claim the current local single-user workflow is multi-tenant.

## Known boundaries

- Cancellation aborts Relay requests; it does not guarantee that Ollama/provider computation or charges stop.
- Saved tasks/outputs are plaintext and can contain sensitive information. Excluding API-key fields is not content redaction.
- Deleting history does not delete exports, backups, cloud-provider records or pending in-memory plans.
- Damaged files are not automatically erased or repaired; inspect the private history directory if warned.
- Use one Relay process per data directory. Cross-process locking, root/ancestor isolation and power-failure fsync durability are not implemented.
- On uncertain execution, the UI does not retry. An orphaned in-memory plan may remain until expiry; intentionally starting another workflow may incur new charges.
- The hosted preview cannot see models on the user's PC. Ollama is the only connected local runtime.
- No native installer, arbitrary desktop access or autonomous shell/MCP execution is delivered yet.

## Next phase/work plan

### Next milestone: document and hardware reliability

**Order:**
1. Add a privacy-conscious diagnostics view/checklist for local runtime/model availability and available system resources; clearly distinguish server resources from the user's browser computer.
2. Validate the existing app on a real PC with two small local models. Test Compare, Brain plan/approval, separate/combined output, cancellation, network loss, saved results and restart recovery.
3. Add configurable conservative context budgets and page-aware document chunking; never silently truncate source text.
4. Move PDF extraction into a time/memory-limited worker and verify malformed/scanned/oversized documents fail safely.
5. Add true token streaming and real-browser tests after lifecycle behavior is stable.

**Exit gate:** no silently lost source pages, clear hardware/runtime errors, verified partial-result identity/recovery, explicit cancellation limits, and no automatic charged replay.

### Then finish Phase 2

Add budgets, controlled revisions, user-approved retries and project organization. Evaluate whether Brain coordination improves quality versus a single-model baseline.

### Phase 3

Permissioned model-driven MCP: start read-only, then reviewed file diffs, then OS-isolated commands/background services. Require audit history and process cleanup tests before enabling broader integrations.

### Phase 4

Desktop packaging/signing/updating and polished accessible run/plan/result screens. Retain the local-first two-workers/optional-Brain product constraint.

### Phase 5

Cross-platform end-to-end validation, security/privacy review, beta users, signed release artifacts, support/rollback procedures and launch.

**Recommendation:** the next implementation should improve context handling and runtime diagnostics, not add unrestricted terminal access. Real-hardware validation remains a gate that cannot be replaced by more mocked tests.
