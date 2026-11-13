# Local streaming milestone

Date: 2026-11-09

## Implemented

- Production Compare and approved Brain workers request Ollama `stream: true` and consume incremental NDJSON. Cloud planning and synthesis are unchanged/non-streaming.
- A bounded decoder handles fragmented UTF-8 and JSON lines. Explicit `done: true` is required for success; unexpected EOF, malformed JSON, runtime error, cancellation and safety-limit overflow return errors with available partial text. Output-limit termination remains incomplete.
- Wire limit: 2 MiB per local call. Pending record limit: 256 KiB. Decoded output limit: 128 KiB. Exceeding limits fails explicitly; it does not silently continue with truncated text. The existing five-minute local request deadline covers stream reading as well as request establishment.
- Worker slots remain separate when responses interleave or B finishes first. Live text is plain text, never interpreted as HTML.
- The browser displays independent Worker A/B drafts through existing **one-second read-only progress polling**. This is runtime streaming plus periodically refreshed browser snapshots, **not SSE/WebSocket token push**. Fast answers can finish before the first poll.
- PDF processing forwards a local-call number and resets the draft for each chunk/reduction call. The visible draft is only the current call, not an accumulated transcript or a verified whole-document answer. Final document results replace drafts.
- Active drafts are kept in memory, with disk checkpoints no more frequently than once per 1.5 seconds per worker from stream callbacks. Stage, cancellation and final saves can persist additional snapshots. Drafts are saved as incomplete/error evidence, never successful final answers.
- Cancellation stops stream reading and prevents new downstream work when observed. Already accepted Ollama/provider computation may continue. Terminal jobs ignore late token callbacks.
- Browser disconnection does not cancel or replay the server run. Saved runs support read-only inspection/cancellation. Restart marks active records interrupted; checkpointed drafts survive, but the newest uncheckpointed tokens can be lost. There is no automatic resume/retry.

## Verification

**89/89 tests pass** (previous audit: 77). New tests cover split Unicode/JSON records, missing completion, malformed/runtime errors, output bounds, stalled-reader cancellation, partial adapter results, output-limit metadata, no retries, throttled checkpoint persistence, B/A identity, restart recovery, late-token rejection, per-document-call token routing and safe live UI rendering.

An HTTP integration test keeps both test-Ollama streams open, reads the run's drafts before either finishes, releases the streams, and verifies completed results replace drafts. The existing large-PDF integration now uses NDJSON from the test runtime. Existing approval, BYOK, history, MCP and adapter regressions remain green.

Dependency audit: zero known vulnerabilities at this check. JavaScript syntax checks and tracked-file whitespace checks pass. These do not substitute for security review.

## Boundaries and next work

No real Ollama weights/GPU or live cloud account were exercised. UI coverage is jsdom, not a graphical browser. The real-PC checklist remains an acceptance gate. Streaming is not a remedy for a model that cannot fit in RAM/VRAM or support the selected context.

Next work:

1. Execute `docs/REAL-PC-CHECKLIST.md` with two small local models, including slow loading, cancellation, runtime loss and a chunked PDF.
2. Add full-browser acceptance and accessibility testing. Validate long drafts, text selection, scroll behavior and recovery after leaving the page.
3. If lower display latency is needed, add a bounded read-only push transport with snapshot/reconnect semantics and no POST replay. Current polling is intentionally retained, not presented as push streaming.
4. Consider cloud Brain streaming separately; retain structured-plan validation and explicit approval, and never add paid calls/retries implicitly.
5. Continue projects/revisions, budgets and tightly bounded model-driven MCP only after streaming/hardware acceptance; distribution still needs OS-level PDF isolation, installers/signing/updating and private beta coverage.

Previous audit findings and broader unfinished work remain documented in `docs/POST-MILESTONE-BUG-HUNT.md`.
