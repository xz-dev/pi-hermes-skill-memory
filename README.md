# pi-hermes-skill-memory

Search-first skill discovery, scoped learning, and reversible maintenance for [Pi](https://github.com/earendil-works/pi).

Find skills without putting the entire catalog into the model's context. Read their contents on demand, turn reusable lessons into project or global skills, and keep changes reviewable and recoverable.

**Automatic review is off by default.** Searching, reading, and local recovery do not call a model. Enabling review or explicitly requesting a semantic merge can consume tokens.

## Install

```bash
pi install git:github.com/xz-dev/pi-hermes-skill-memory
```

Restart Pi or run `/reload` after installation.

Requires Node.js **22.19+**. Tested against official Pi and pi-ai **0.99.2**, using public APIs only; no Pi fork or subagent extension is required. Cached-package restoration supports the verified 0.99.2 layout and fails closed for unverified layouts.

## Usage

Start with discovery:

```text
/hermes-skills status
/hermes-skills refresh
```

The agent gets three tools:

| Tool | Purpose |
| --- | --- |
| `hermes_skill_search` | Bounded search and paginated lists with stable skill IDs |
| `hermes_skill_view` | Read the skill or one supporting file, with versions and pagination |
| `hermes_skill_manage` | Submit guarded, scoped changes |

Global and project skills with the same name keep separate IDs. Native exclusions, project trust, and explicit-only loading remain in effect. Reading a script never executes it.

Use `/hermes-skills load <SkillId>` for explicit loading. Switch the prompt's catalog presentation with `/hermes-skills mode native` or `/hermes-skills mode search`; this does not rewrite Pi settings or remove earlier chat content.

### Learning and costs

```text
/hermes-review enable
/hermes-review status
/hermes-review usage
/hermes-review errors
/hermes-review pause
/hermes-review disable
```

Non-Git projects require an explicit project root before enabling writes. Automatic review becomes due after ten tool-bearing assistant turns and runs only after the foreground task settles. It uses the current effective context, including compaction, and the current model—not a hidden incremental summary or a second model.

| Default limit | Budget |
| --- | --- |
| Requests per review | 1; no automatic retry or fallback |
| Input / output per review | 64,000 / 4,096 tokens |
| Timeout | 90 seconds |
| Reviews per UTC day | 4 |
| Daily input / output | 256,000 / 16,384 tokens |
| Concurrent reviews | 1 per agent directory |

Input admission uses a conservative UTF-8 byte estimate, not measured token usage. Oversized snapshots are skipped rather than silently truncated. Failures and unknown usage pause review and remain visible across reload. Unknown requests retain their reservations; cancellation does not prove that the provider charged nothing.

`/hermes-review run` requests one metered review manually. `resume` acknowledges errors without clearing unknown reservations or enabling automation. `retry` requires an explicit budget confirmation. Auxiliary usage is shown separately from Pi's primary session usage; it is not a verified bill.

### Approval and maintenance

Only skills with matching creation records are managed. Existing, installed, and externally supplied skills remain user-owned. Changes check current source permission, scope, pin, and read versions.

Evidence-bound quotations and supported host templates can be saved automatically. Unverified prose or assets become bounded pending proposals. Local TUI approval shows the exact diff; approving bytes does not certify factual claims. A global installed-skill permission does not bypass content approval, and RPC cannot impersonate that TUI approval.

```text
/hermes-skills pending
/hermes-skills approve <pending-id>
/hermes-skills inspect <SkillId>
/hermes-skills pin <SkillId>
/hermes-skills curate list
/hermes-skills history <SkillId>
/hermes-skills archives
```

Semantic merging is explicit: `curate propose <keep-id> <absorb-id>` makes one metered request; `curate apply <pending-id>` requires local approval. The kept skill is saved before the absorbed members are archived. This is recoverable per-member progress, not a cross-file atomic transaction.

Archive, restore, and rollback retain versions and refuse to overwrite later human edits. Shared references and unlisted neighbors are not silently removed. There is no automatic permanent purge, package installation, or script execution.

See [usage and recovery](docs/usage.md), [semantic curation](docs/curation.md), and [maintenance evidence](docs/maintenance-evidence.md) for command details and interruption recovery.

## SDK integration

Embedded hosts use `createSkillsExtension` from `src/index.ts`, supplying `agentDir` and a `skillSources` callback with the final allowed skills **before name deduplication**. The extension does not guess runtime exclusions or scan unknown directories to fill gaps.

`projectRoot` and `restorePolicy` are optional. Without a current missing-path restore policy, restoration is blocked while ordinary discovery and reading remain available. Hosts must retire the previous session when switching projects. See [source integration](docs/source-discovery-boundary.md).

## Memory-plugin compatibility

This extension works on its own. It does not import or require `pi-hermes-managed-memory`.

Optional `hermes.review.v1` cooperation is verified with a protocol peer double: compatible, simultaneously due targets share one request and ledger entry, then commit their own data. **The current companion memory implementation is not verified compatible**; its fee policy and ledger differ. Do not assume both current checkouts can enable joint automatic learning. See [the cooperation contract and limits](docs/review-cooperation.md).

## Remove

```bash
pi remove git:github.com/xz-dev/pi-hermes-skill-memory
```

Reload or restart Pi. Standard `SKILL.md` files remain usable through native discovery. Existing ledgers, pending changes, and backups are retained, not erased.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
```

Tests use isolated agent directories and fake providers. The 160-test checkpoint covers accounting, sources, approval, cancellation, recovery, and protocol cooperation; native TUI acceptance is recorded separately. Historical limited model tests are not part of `npm test` and require separate authorization. These checks do not establish long-term model quality or actual billing.

- [Fee regression matrix](docs/fee-matrix.md)
- [Native isolated acceptance](docs/delivery-evidence.md)
- [Specifications and implementation traceability](docs/traceability.md)

## License

[MIT](LICENSE). Adapted upstream code retains its notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
