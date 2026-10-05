# 6.3 — per-member lifecycle operations

Confirmed by user:
- Managed archive uses proven creation-record members, not arbitrary directory contents.
- Installed archive uses an explicit file list and exact diff/path/version approval. Shared references are backed up but not removed; unlisted neighboring skills/files remain unchanged. Global installed modification grant does not grant directory ownership.
- Restore requires current host source authorization, including when the archived primary is absent from the current Skill[] snapshot. No explicit-user bypass of host exclusions/noSkills. SDK needs a narrow optional restore-admission hook; without it restoration is visibly blocked, not guessed. Normal read/search remains unchanged.

Acceptance path: archive permitted primary + proven/explicit members into non-scanned metadata storage → default discovery excludes archive → reauthorize absent destination against current host exclusions → restore without overwriting any new or hand-edited member → same scope/identity/owner. Shared references retained in place must match before they can be reused; conflicts preserve both versions. Rollback checks current after hashes and preserves manual edits; create rollback archives rather than purges. Known local references are reported, external references explicitly unchecked. Every operation exposes actual changed/pending/conflict/failed state and local recovery, not a fictional multi-file atomic transaction.

6.3 completed against the finite checklist below. 6.2 semantic absorption builds on this path and remains separate. No extra paid request, hidden scheduler, personal installation or memory-repo edits.

## Finite completion checklist (6.3)

| Required behavior | Evidence / remaining check |
| --- | --- |
| Archive exact owned/selected members, retain shared assets and neighbors; hide archived skills | `archive.test.ts` managed/installed cases pass |
| Same identity/owner/bytes restored only with current source authorization | `restore-sources.test.ts`: six registered paths, including cached npm/Git; current exclusion, withdrawn selection, npm version and rebound path rejected |
| Stock current-source rules agree with official resolver while target is absent | Forty configuration/package differential cases plus cached npm/five Git forms; no target probe writes |
| Exact rollback, introduced member retention/removal, subsequent human edit and pin protection | `rollback.test.ts` managed/installed paths pass |
| Interrupted maintenance visible across reload; resume locally, no model replay | Managed/installed rollback and archive interruptions pass; installed recovery rejects revoked grants and reauthorizes each member |
| Shared-reference conflict and restore permission withdrawal | Registered-command shared-reference conflict, asynchronous restore grant withdrawal and fresh local approval pass |
| Native maintenance UI and default CLI source/restore entrypoints | Official production CLI entrypoint: rollback No/Yes, archive, exclusion-denied restore, reload-visible error, allowed restoration; see `docs/maintenance-evidence.md` |
| Current whole-tree checks and bounded compatibility claim | Typecheck0, full125/125, strict0 at `/var/tmp/hermes-maintenance-{check,full,validate}.log`; each checklist item has behavioral evidence |

The cache locator follows the verified official 0.99.2 layout and rejects unverified SDK cache-layout versions. This is not an all-future-Pi compatibility claim; an SDK host can supply its own current restore policy. Location calculation is read-only and contains no private SDK runtime import, cache-directory search, install or restoration probe.

