# Relay — Bug hunt, current status and next-phase plan

## Executive summary

**Status: local-first development alpha, not a completed release.** Two installed Ollama models perform production work. One optional cloud Brain uses the user's own API key for planning and synthesis. The audit fixed nine issue groups and expanded the automated suite from 27 to **35 passing tests**.

No live model weights, real cloud credentials, native installers or Windows/macOS devices were available for validation. A test suite is not proof that every bug is gone.

## Scope and method

Reviewed local discovery/inference, Brain planning/approval/execution, capacity and lifecycle boundaries, request parsing, the local launcher, browser control state, and MCP workspace/client behavior. Added targeted regressions. The first audit run reproduced two failing checks: a null runtime entry broke discovery, and oversized JSON incorrectly returned 400 instead of 413. The remaining fixes came from code-path analysis and targeted tests of corrected behavior.

## Fixed issues

| # | Priority | Issue and effect | Fix and verification |
|---|---|---|---|
| 1 | High reliability | A null or malformed item in Ollama's model list threw during filtering, making valid models disappear and displaying a false disconnected state. | Validate each entry before reading fields. Regression includes null, numbers, empty objects and valid models. |
| 2 | High approval integrity | The server did not store the reviewed output mode. An execution request could request combined synthesis even if a separate-output plan had been reviewed, adding an unreviewed cloud call. | Store output choice in the plan and reject mismatches before running workers. HTTP lifecycle test checks rejection, zero new calls, and subsequent correct execution. |
| 3 | Medium capacity | Concurrent planners checked only completed plans, so in-flight planning could exceed the 20-plan cap and incur extra Brain calls. | Reserve capacity before awaiting extraction/planning; release reservations on success and failure. A concurrency regression admits 20 planners and rejects the 21st before another Brain call. Plan stores are now scoped to each registered app. |
| 4 | Medium UI consistency | Model refresh did not lock task submission. A refresh response could replace model selections while a workflow was starting. | Track refreshing state, lock task/model/mode controls and block submission until it completes. DOM regression verifies no third request is submitted while refresh is pending. |
| 5 | Medium recovery | A closed MCP client remained cached, preventing later requests from recovering without restarting Relay. | Invalidate the cache when the connected transport closes. Real SDK test closes the cached client, obtains a new client and successfully discovers tools again. Tool calls are not automatically replayed. |
| 6 | Medium API handling | Oversized JSON returned generic 400, and parser errors used parser-provided messages rather than a fixed safe message. | Return 413 for oversized JSON and sanitized 400 for malformed JSON. HTTP regressions verify both and absence of a supplied secret marker in the error. No actual credential disclosure was demonstrated. |
| 7 | Medium startup | The launcher printed a guessed URL before the server started; .env/custom/ephemeral ports could disagree, and startup conflicts produced poor guidance. | Server reports actual ready port over IPC; launcher prints the URL only then. Parse PORT as an integer; reject invalid ranges/pipe names; handle port conflicts with guidance. Tests launch the real local app on an ephemeral port and fetch its homepage. |
| 8 | Medium portability hardening | Filename checks admitted Windows device names such as CON/NUL and trailing-dot names, which do not behave like ordinary files on Windows. | Reject reserved device names (including extensions), trailing dots and existing traversal cases. Unit tests cover the validation rule. Actual Windows filesystem behavior remains untested. |
| 9 | Low developer compatibility | jsdom 31 required specific newer Node releases while documentation advertised Node 22+. | Use jsdom 26 and declare the Node >=22 project requirement. All DOM regressions pass with the updated lockfile. Not a full Node-version matrix test. |

Also corrected PDF-selection wording: local workers receive documents locally; cloud sharing occurs in Brain mode.

## Verification results

- **35/35 automated tests pass** with `npm test`.
- Actual HTTP tests: model discovery/inference through a protocol-compatible test Ollama service, cloud-worker refusal, request guard, JSON errors and PDF extraction.
- Actual MCP SDK tests: discovery, create/read/list, approval, overwrite/traversal/symlink/size denial, and reconnect after transport closure.
- Brain tests: BYOK-only cloud calls, editable approval, both output modes, failures, single-use/discard, stored output choice and concurrent plan cap.
- DOM tests: local selectors, full approval flow, safe text rendering, offline state, refresh locking.
- Real local launcher test: ephemeral-port readiness, local homepage, process cleanup.
- Dependency audit: `npm audit` reports **0 known vulnerabilities** at this check. This is not a security guarantee; some transitive dependencies still emit deprecation warnings.
- Syntax and Git whitespace checks pass.
- PDF.js emits missing DOMMatrix/Path2D warnings in this headless runtime. Text extraction tests pass; PDF page rendering is not implemented or verified.

## What works today

1. Download/extract source, start Ollama, and run `npm ci` then `npm run local` on the same PC.
2. Discover/select two different installed Ollama models.
3. Submit a task with an optional text-based PDF.
4. Run local Compare without any cloud key.
5. Optionally select one BYOK cloud Brain, generate two assignments, edit/approve them and receive separate answers or one combined report.
6. Inspect original worker results, export Markdown, use in-tab history and manually operate the bounded MCP file workspace.

The hosted preview cannot reach models on a user's PC. A terminal command does not create a remote tunnel. The current app uses the local browser, not a native desktop installer. Ollama is the only supported local runtime.

## What is left to complete

### Release blockers
- Real-PC Ollama tests, including low-memory systems, model loading, runtime restart and large documents.
- Live Brain-provider validation with user-authorized keys and allowed network access.
- Windows/macOS/Linux local install, shutdown and filesystem validation.
- Native distribution decision, installer builds, signing, updates and uninstall behavior.
- Durable local projects/history with deletion and retention controls; keys must not be stored by accident.
- Streaming/progress and cancellation with explicit semantics: aborting HTTP does not guarantee the local runtime stopped generation.
- Token/context-aware PDF handling and resource-isolated PDF parsing.
- Real-browser/mobile/accessibility tests and security review before distributing broadly.

### Remaining planned capabilities
- Usage budgets, revision limits and explicit safe retry controls.
- Optional manual task-division workflows beyond the Brain plan.
- Model-driven MCP tool calls with approval, scoped permissions and audit history.
- Trusted external MCP connections and credential handling.
- OS-isolated shell execution, file-edit coordination and background-app/process lifecycle.
- OCR and richer document/export workflows.
- Authentication, per-user isolation and quotas only if we add a hosted multi-user product. Local launcher is not a public service.

### Known limits not fixed in this audit
- No durable recovery after tab/server loss; plans and history remain temporary.
- No native installer and no autonomous agents/background apps.
- Local response bodies and PDF parsing are not fully resource-isolated; no token-aware chunking.
- Installed-model discovery does not verify useful task quality, available memory, or every model's context capability.
- Keys and document content are sent to the selected cloud Brain in Brain mode; BYOK is billing ownership, not zero cost or offline privacy.
- Application-level MCP path restrictions are not an OS sandbox. Keep the workspace directory and ancestors trusted.

## Next phase/work plan

### Next milestone — finish core reliability before adding more agent power

**Order of work:**
1. Run the existing two-local-model + optional Brain flow on a real PC; capture hardware/runtime diagnostics without logging prompts or keys.
2. Add durable local projects and explicit deletion; persist run states and outputs, never session keys.
3. Add progress/streaming and cancellation, then test queued/loading/generating/disconnected states.
4. Add document context sizing/chunking and resource-limited extraction.
5. Perform real-browser and cross-platform checks; stabilize the onboarding flow.

**Exit criteria:** a user can set up two local models, complete PDF workflows in both output modes, recover saved work after restart, stop runs with clear guarantees, and understand every failure without an accidental cloud call or hidden retry.

### Phase 2 completion — collaboration controls

Add budget/revision controls, explicit retries, stronger plan/result provenance and evaluation against a single-model baseline. Keep one optional Brain and two local production slots as the product constraint.

### Phase 3 — controlled agents and MCP expansion

Connect workers to permissioned tools only after run lifecycle and approvals are reliable. Start read-only, add reviewed file diffs, then isolated commands/background services. Add per-call audit history and cleanup tests before external MCP integrations.

### Phase 4 — desktop product and polished UI

Package the local runtime/UI, build/sign installers, provide updates, improve plan/run/result screens, and complete accessibility/onboarding. Initial UI already exists; packaging and refinement are not done.

### Phase 5 — beta and launch

Cross-platform end-to-end tests, privacy/security review, hardware/quality benchmarks, documentation, beta feedback, release artifacts and support procedures. Do not label the app production-ready until these gates pass.

**Recommended next action: real-PC validation followed by durable local project storage—not unrestricted terminal access.**
