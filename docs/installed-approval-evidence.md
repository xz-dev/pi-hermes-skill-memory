# Installed-skill approval evidence (4.3)

Official Pi / pi-ai 0.99.2, public imports only. Current repo-local type check and complete regression: **81 tests passed, 0 failed**. Raw logs: `/var/tmp/pi-hermes-planning-FnQ7Ay/installed-final-{check,test}.log`.

## SDK contracts

`test/installed-approval.test.ts` has eight behavior checks:

- TUI-mode contract: reject preserves bytes; accept saves only the seen diff, and a second mutation still needs approval. Ownership remains user-owned/local-modified, not managed.
- Print and RPC hasUI enqueue pending; RPC cannot approve. Later TUI approval submits locally without another model request. Project settings cannot set the global grant.
- Changing bytes after confirmation or before pending approval rejects the old version.
- Registered `/hermes-review run` in TUI produces pending without opening a dialog/editor. The one fake analysis records its 128 reported tokens once.
- Existing references require their own read version. A three-member installed update interrupted after primary replacement reports committed/prepared/prepared; abort cannot pretend rollback; local commit completes the remainder without executing the script or replaying a model.
- Pending capacity is at most 32 records and 1,000,000 serialized characters, with a 384,000-character per-record limit; overflow and stale enqueue eligibility reject. Only cited evidence excerpts and relevant read receipts are retained, not full conversation snapshots.
- Source exclusion after confirmation blocks the write and does not request paid repair.
- Only an explicit user command sets the durable global grant; read-only/excluded targets still reject.

These tests simulate the UI callback contract; they do not demonstrate the native interface by themselves.

## Native terminal interaction

An official 0.99.2 CLI ran `test/fixtures/tui-installed.ts` in isolated `/var/tmp/hermes-installed-tui-krODYc`, with temporary HOME/agentDir, child-scoped offline mode, no session file and a local fake provider. No personal extensions, sources or credentials were loaded.

The production permission path uses the public multiline `ctx.ui.editor` for the full diff, then `ctx.ui.confirm` for the bound target/scope/version/files/diff hash. Viewer edits or cancellation cannot change the proposed operation. Interactive viewing happens before the writer lock; save reconstructs the same diff under the lock and refuses mismatches.

Captured evidence in that directory:

- `preview-top.txt`: PageUp revealed stable target, project scope, path, base version, unchanged user ownership, original body and the start of the replacement.
- `preview-bottom.txt`: PageDown revealed the long replacement's `FINAL NEW RULE` and the second member's `REFERENCE AFTER`.
- `deny-confirm.txt` / `denied.txt`: selecting No retained original hash `53a13c820c43e16b1ad9dd6f57dc8333619e23970b12728f34236079d62d0b21`; no reference file was created.
- `accept-confirm.txt` / `accepted.txt`: after reviewing again, Yes saved hash `55b86d641b2fe769b6fbc55bdeea0a122e3abbe215821db356d45624bf838bf8`.
- `byte-verification.json`: both final member contents exactly match the approved per-member plan; the reported version equals the actual file hash. The plan remains installed/local-modified; auxiliary review ledger has zero records.

The first CLI fixture attempt used `--no-tools`, which disables extension tools too, and failed without saving. The successful run explicitly selected the three registered skill tools. That failed attempt is not approval evidence. The temporary tmux session was exited.

This verifies native rendering, navigation, selection and byte binding, not human acceptance of daily UX or real model learning quality. It is not a billing test. No real model requests, plugin installation, Git commit/push, or companion-memory changes occurred. Archive/restore/rollback and their permission checks remain task 6.3; shared R2/R5 compatibility remains the joint charging gate.

## Local controls

- `/hermes-skills pending` lists bounded proposals and original versions.
- `/hermes-skills approve <id>` requires actual TUI, checks current source/version/project and presents the exact queued diff before local commit.
- `/hermes-skills reject <id>` removes the pending proposal without touching the source.
- `/hermes-skills installed allow` requires native TUI confirmation; non-TUI uses the explicit user command `installed allow --acknowledge`. `installed deny` revokes the grant. No model tool exposes a grant setter.
- `/hermes-review recovery` and `recover <key> commit|abort` inspect and resolve approved staged members locally; they do not reclassify usage or turn installed skills into managed skills.
