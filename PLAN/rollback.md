# 6.3 rollback slice

User-visible path: history for an allowed SkillId → select a saved change → compare current bytes to that change's after versions → exact reverse diff → local rollback. An installed target uses the existing exact TUI/global-grant/pending permission gate; owner is unchanged. Creation rollback delegates to reversible per-member archive, not purge.

Restore exact prior bytes, including installed frontmatter formatting. Reuse ManagedSkillStore's writer/lock/approved intent/member states/recovery rather than introduce a second patch engine. A member introduced by the selected change has a null prior version: preserve its after bytes outside discovery before removing it from the active skill. Models cannot request arbitrary file deletion through Proposal; removal is derived only from the selected, approved saved history.

Examples: managed and installed updates reverse primary/reference bytes and retire a newly introduced member; hand editing after the selected change rejects rollback; RPC cannot approve an installed rollback; local approval does not add model calls or affect prior review accounting. Interrupted reversal reports actual members and resumes through the existing local recovery path. Source/pin/version checks stay current. No new verifier, provider request, dependency, or automatic rollback.
