# 6.2 — reviewable curation

Scope: local deterministic candidate list, explicit semantic proposal using the existing one-request review, no scheduled paid curation. Sources must be host-allowed, managed, non-pinned and writable. Similar names alone do not establish duplicate content; reported success is not confirmed business success.

Concrete path from the accepted maintenance spec:
1. `curate list` shows exact-body duplicate groups and usage evidence; excludes protected or host-excluded sources and performs zero model calls/writes. No arbitrary mtime/day deletion threshold is introduced.
2. Repeated lessons use the already-read stable existing ID and version. Creating another skill with exactly the same normalized body in the same scope is rejected with the existing ID; explicit update can associate the new evidence without a date-named reference or new skill.
3. `curate propose <keep-id> <absorb-id>` is an explicit single metered review. Show reasons, before/after and retained source versions; free-form merge content still needs local exact approval. No result/invalid result/failure adds a second request.
4. `curate apply <pending-id>` (also `approve <pending-id>`) requires actual TUI confirmation of the combined exact diff. Save the keep skill through the existing store, then archive the absorbed skill through the existing per-member archive writer. A bounded applying pending record links the two operations; incomplete work is visible across reload and blocks new paid work. Recover an interrupted store child first, then repeat local apply; no model replay or fictional atomic rollback.

User decision: per-member archive. Managed moves are limited to proven creation-record members. Installed operations require an explicit file list and exact preview/approval; shared references are backed up but remain in place, and unlisted neighbor files are untouched. A global installed-skill grant does not make a shared parent directory the selected skill's property.

No new dependencies, no global/private installation, no model-quality or billing claims from fake fixtures. Full OMD range/link continuation remains7.3, and shared R2/R5 decisions remain7.1.

## Completed behavior checks

`test/curation.test.ts`: **12/12**. Current whole-tree typecheck0, **135/135**, strict0 (`/var/tmp/hermes-curate-{check,focused,full,validate}.log`).

- Deterministic candidates and repeated rule read/update remain free and bounded; no mtime deletion policy.
- One explicit registered semantic proposal → bounded pending → exact local approval → keep save → absorbed members archived → explicit host-authorized restoration works. Original model receipt/usage stays unchanged by local apply/restore.
- Current context remains intact; both managed inputs' proven files/read versions are added for analysis. Oversized input skips without truncation or a request.
- Protected, user-owned, excluded and cross-scope targets reject before admission. Global installed grant does not bypass merge content approval; RPC cannot approve.
- Stale input rejects; no-change and invalid targets preserve both skills without retry.
- Real keep-member and archive-member interruptions record actual progress. Reload keeps attention visible; existing child recovery plus local apply completes without another request or repeated keep save.
- Cancelled review retains the same request ID and original terminal reason; late 128-token fake usage updates accounting only. Neither input nor pending is written. The initially red late-result test incorrectly waited for a reason rewrite; the fixed check observes actual usage, not UI wording.

6.2 is complete on these deterministic/SDK contracts. Native diff rendering was verified in6.3; these cases do not claim new human UX, real semantic quality or actual billing evidence. Joint charging and OMD delivery remain7.1–7.3.

