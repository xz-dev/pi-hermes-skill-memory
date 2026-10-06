# Autonomous notebook acceptance

## Boundary and commands

`enable-autonomous-skill-notebook` builds on the dirty quiet-UI baseline, not a fresh install. Official npm Pi / pi-ai **0.99.2**, public APIs, isolated `/var/tmp` agentDirs and deterministic providers. No personal install/state, paid model, model switch, subprocess product fallback, staging, commit, push or release.

Evidence directory: `/var/tmp/hermes-sol-integration-qRlhS3/`. These local logs are reproducible evidence, not portable product data. Source/file hashes and final command receipts belong in the handoff and notebook traceability report.

```sh
npm run check
npm test
openspec validate enable-autonomous-skill-notebook --strict --no-interactive
git diff --check
HERMES_ACCEPTANCE_REPORT=/var/tmp/hermes-sol-integration-qRlhS3/public-flow.json \
  node --test test/notebook-acceptance.test.ts
```

Current gate-before-trace checkpoint: typecheck exit 0; **207 passed, 0 failed**; change strict validation exit 0; diff check exit 0. Final gate must be rerun after documentation/traceability completion. Earlier failed fixture/type/native-harness attempts remain in local logs; they are not accepted receipts.

## Public tool positive flow

`test/notebook-acceptance.test.ts` uses real registered `hermes_skill_manage`, `hermes_skill_search` and `hermes_skill_view` calls in SDK turns. It saves ordinary `ci-review-notes`, finds it through original keyword `github-pr-workflow`, reads actual current version, and revises SAME identity with new user evidence. Both saves are `agent-notes`; no permission/content pending, no auxiliary analysis and no confirmed/reported success counters.

Exact description remains `github-pr-workflow: a passed CI job is not enough to merge`. Initial body remains `Do not infer merge readiness solely from CI.`; correction becomes `CI plus required code review decide merge readiness.`. Supporting file bytes and provenance are checked, history retains before/after versions, and no relation field/file is created. `public-flow.json` records actual ID, version transition, bytes, evidence and tool receipts from this run, not invented example IDs.

## Policy and review acceptance

- `permission-policy`, `policy-decisions`, `installed-approval`: v1→v2 migration without executing old rows; three policies × exact-ID allowlist; once/always/reject/fourth/cancel; same-turn refusals; TUI vs RPC/Print; source/version/pin/read-only safeguards. 257th NEW allowlist member rejects before persisted-byte mutation; duplicate at capacity stays idempotent.
- `content`, `notebook-acceptance`: Chinese free notes/assets, ordinary prose preservation, explicit legacy rendering, historical pending/approved/restored records, evidence/path/scope/version rejection. Provenance is not factual certification.
- `review-destinations`: bounded `{proposal, managedAlternative?}` operation envelope and legacy flat compatibility. All candidates validate before writes/feedback; policy/allowlist selects ONE committed path, four local choices select neither/original/note, cancellation saves neither. Candidate metadata never replaces actual read/version. Excluded originals cannot be laundered; readable protected originals can yield independent notes. Separate lessons sharing evidence remain separate, without heuristic grouping. Global originals do not promote project-only lessons.
- `notebook-guidance`: 10,000-entry collection leaves constant-size search/reuse/save guidance; no full catalog, script execution authority or semantic/body-search claim.
- `automatic-learning`, `snapshot`, `scheduling`, `lifecycle`: no enable or explicit true required in fresh valid state; existing switch/pauses preserved; normal ten-tool-turn settled dispatch, independent user count, dedup, compaction projection, cancellation/late-accounting and no startup/shutdown flush.
- `fee-matrix`, `ledger`, `review-limits`, `cooperation`: unchanged 64,000/4,096/90s, UTC 4/256,000/16,384, concurrency 1 and tightening-only limits. Unknown retains quota/pause; late over-reservation pauses again; no hidden verifier/retrieval/retry. Protocol peer doubles are not real companion-memory acceptance.
- `archive`, `rollback`, `recovery`, `curation`: location operations do not redirect to fictional success; latest notes-only defeats historical exact approval. Recovery allowlist priority works per member; partial is not atomic rollback, hand edits/shared references/neighbors remain protected.

## Actual isolated terminal

`test/fixtures/tui-notebook.ts` runs official `dist/bundle/cli.js` under a dedicated tmux PTY with `env -i`, temporary HOME/cache/agentDir, offline startup, no discovered extensions/skills/context/templates/themes, no session file and only three public skill tools. Fake provider is local code, never HTTP. Driver commands/logs: `native.py`, `native-continue.py`, `native-verify.py`, `native-*.txt`, `native-verified.json`.

Observed actual terminal selector lists all four choices after full bound per-member editor. Cancel and reject preserve original/grants; fourth returns unsaved redirect then normal foreground metadata search and actual managed-note save. Once updates original/support member without a grant; always adds exact-ID grant; later reuse skips prompt; on-demand settings labels name/scope/ID and removes grant. `/hermes-review usage` shows primary separately from auxiliary usage. Default-on normal threshold made one counted fake no-change review (30 tokens); later oversized snapshot was skipped without provider call. No resident plugin status/widget. Driver verifies persisted bytes/proof, choice receipts, grant removal, call count and terminal cleanup. This is native PTY evidence, distinct from SDK UI callback tests.

## Limits

No live model learning-quality, actual billing, remote provider retry behavior, cache-hit guarantee, human daily UX or real memory-plugin interoperability claim. Foreground follow-up is normal paid agent work, not free learning. Wrong model notes remain possible; provenance/history/correction expose them without semantic certification. Metadata keyword search can miss relevant/duplicate notes. Current root/restore/source authorization remains host-owned; no silent installation or personal activation performed.
