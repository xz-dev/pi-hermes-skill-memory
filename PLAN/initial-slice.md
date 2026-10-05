# Implementation slice: tasks 1.1–1.4

- [x] Official npm 0.99.2 extension bootstrap; no load-time work or automatic calls.
- [x] SDK verification of skills input, unrelated section preservation, compaction-aware projection, standalone ModelRegistry request isolation.
- [x] Single-plugin service seam: fake-provider snapshot → sourced managed proposal → version/scope check → save → fresh store search/view → one metered record.
- [x] Explicitly authorized SWE-2 samples; synthetic non-private release/correction/temporary examples and later reuse. Four requests, 2,131 reported tokens, no model fallback; see docs/swe2-validation.md.

Existing OpenSpec scenarios and user apply authorization control this slice. No branch/commit operations: user has not requested them. Native `node:test` suffices; no test framework dependency.

The shipped entry remains index-only. Core learning service is exercised separately; automated scheduling, complete catalog, installed-skill approval, full TUI and cross-plugin/process behavior remain pending. Startup performs no model call and creates no managed directories.

Evidence: `test/bootstrap.test.ts`, `test/learning.test.ts`, `docs/implementation-evidence.md`. Specs/tasks remain authoritative, this note is progress only.
