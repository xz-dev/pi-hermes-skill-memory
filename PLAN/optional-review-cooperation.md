# 7.1 — independent plugins, optional review cooperation

User clarification: the two plugins can be used separately and must not depend on each other. Standalone skill operation keeps its existing fee policy. Memory-side R2/R5 approval does not authorize changing skill accounting or editing the memory repo.

Bounded contract verified in this repo with a protocol peer double:

- No peer installed: the same skill review/store/ledger/UI path works alone. No imports, package dependencies or required service from the companion repository.
- Active compatible participants at the same session/project/leaf/model/effective-snapshot boundary declare classified targets through public `pi.events` only. A deterministic owner makes one existing-budget request; each participant validates and writes only its own target.
- Concurrent/late declarations do not produce a second request for an already handled boundary. The shared on-disk ledger remains the cross-process authority, not an in-memory event race.
- Protocol, identity, fee-policy or ledger-schema uncertainty pauses charging with a visible error, never independent paid fallback. Inactive compatible peers do not become required participants.
- Cancellation invalidates participating writers. Unknown/no-change/failure costs stay in the single request record; no retry or fee-policy expansion is added here.

Actual companion runtime is currently not a verified protocol participant and its fee contract differs. Passing a compatible protocol double is not a claim that the current memory checkout is interoperable. Keep that diagnostic explicit; do not copy its implementation or change either fee policy merely to make a test pass.

Checkpoint: registered SDK joint/standalone cases15/15 plus the cross-process boundary admission case; current whole-tree check0/full151/151/strict0. Production `ui.ts` uses the optional rendezvous before `reviewSkills`; the existing ledger atomically records owner/targets/boundary, and the existing skill writer plus the peer's own consumer commit separately. Cancellation and late telemetry retain one request. Details and limitations: `docs/review-cooperation.md`. No memory-repository changes or real provider calls.
