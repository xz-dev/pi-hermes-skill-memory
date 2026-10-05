# Verifiable automatic content — task 5.3

User decision: choose **可验证内容自动保存（Recommended）**. No second model call. Automatic commits accept only content the host can explicitly bind to current evidence (quotation/host template). Free reformulations with unverifiable assertions become bounded pending proposals; the user reviews the exact diff before local approval.

Reproduction, local and read-only: validateProposal currently accepts citation `Please run tests` with body `All tests passed.`. A citation's existence does not prove a body assertion. No files/provider requests were involved.

- [x] Add a deterministic content-proof gate at the common model submission seam; permissions and content proof remain separate. Global installed-write permission cannot bypass this gate.
- [x] Preserve source attribution for automatically quoted/template content. An evidence quote is a report of that source, not certification that a test actually ran.
- [x] Reuse bounded pending for unverifiable managed creates/updates as well as installed updates; don't retry the model or silently drop useful proposals.
- [x] Local approval revalidates exact file versions, source identity, current project and diff; original accounting record stays unchanged.
- [x] Prove requested-but-unrun success is pending, supported quoted procedure can save/reuse, malformed/tool-request/incomplete output is single-request refusal, and no recursive tool/model work occurs.

The existing normative host-validation requirement remains; this decision refines its implementation rather than weakening the guarantee. 5.3 已完成；当前类型检查及91/91回归通过。Shared R2/R5 disagreement remains a separate joint-charging gate.
