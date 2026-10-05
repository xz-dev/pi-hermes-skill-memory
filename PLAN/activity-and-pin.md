# Task 6.1 — views, reports, confirmations and pin

User selected **自动反馈分栏**: automatic viewing statistics; model use/outcome reports with current evidence through the existing single review request, clearly not independently certified; explicit user confirmations counted separately. No extra model verifier. Earlier content-proof/pending policy is unchanged.

User subsequently selected **完整历史去重** rather than a recent 4096-receipt window. Local event fingerprints grow with history; only the display journal is bounded. Retained counters never silently reset. A pre-release state that already lost dedup receipts reports incomplete history and blocks new statistics instead of pretending to recover missing fingerprints.

Acceptance examples:
- Reading a skill increments views, not uses or successes. Independent review/host store reads do not impersonate foreground usage.
- A model reports use plus a failed outcome with actual read id/version and current citation: reported-use/failure increment, user-confirmed success remains zero. Reported success similarly does not mean confirmed success; replay of the same evidence does not inflate counts.
- An explicit local user outcome command records user confirmation and source/session/version; it does not rewrite model reports or incur a model request.
- Pin is an explicit local user policy. Rare pinned skills remain searchable, and model proposals/automatic maintenance cannot update them. Unpin must be explicit, not model/project metadata.
- User-owned and read-only sources do not become managed from statistics or pin. Source/version/permission gates remain mandatory.

Implementation slice:
- agentDir-owned counters + bounded evidence journal + persistent all-history dedup fingerprints; no timers/providers.
- registered foreground view and explicit load record activity; review consumes optional bounded feedback in its existing JSON response.
- commands inspect/pin/unpin/use/outcome provide local control; catalog/store consult the same pin policy.
- verify through existing SDK/node:test fixtures and full regression; do not claim native human UX or real model quality from fake data.

Verified: `test/activity.test.ts` 8/8; current typecheck exit0 and full regression104/104 in `/var/tmp/hermes-activity-{check,test,full}.log`. Registered SDK search/read → existing single fake review → inspect/ledger covers reported failure and success, explicit confirmation, no extra calls, source withdrawal, and actual installed/managed pin rejection. Persistence test retains the original report plus5000 later receipts, reconstructs the store, and rejects a repeated report even with duplicate citations. 4096 and aggregate-capacity boundaries retain counters and separate pin, with visible unrecorded-read warning; missing/corrupt pin policy rejects writes. Guard cancellation exits the controlled writer and releases its lock before late authorization returns. Statistics are source reports, not independent business-result certification.
