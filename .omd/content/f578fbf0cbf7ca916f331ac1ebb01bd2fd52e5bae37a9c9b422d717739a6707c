# Skill 插件规划证据索引

此索引只记录已核验且影响首版的机制，不宣称穷尽 Hermes。事实、用户决定和新增设计分开；后续 OMD 将本页的具体段落与 design、requirements、tasks 关联。连线表示追溯关系，不表示实现或测试已通过。

基线：Hermes `234badf4012af380d23c91eae55d045a69c69ffb`；官方 Pi `a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4` / `@earendil-works/pi-coding-agent` 0.99.2。下载归档 SHA256：Hermes `cd9ec67319b979fd768e06c2de308cedb786a039c77234006e9b771f0e9e0c79`；Pi `ab7aab534c77e40ad5f36e69f1e4f6858d5ff98862a25c1950025f9518ff9def`。临时源码缓存不是唯一恢复来源，以下使用固定提交链接。

## U1 — 已确认的产品决定

用户确认仅官方 Pi；搜索优先；同模型当前有效上下文快照审查；受管内容自动维护；手装 skill 可修改但须 TUI 确认或用户全局自动允许。外部记忆后端只保留设计评估。随后明确要求避免旧插件类似的巨额 token 消耗和 TUI 隐藏失败。

本插件据此新增有界收费入口、持久用量/故障面板、双插件合并审查和项目级生成。不能将这些新增策略写成 Hermes 的既有行为。默认费用上限是保守设计参数，不是实测账单预测。

## P1 — 官方提示词可以改变 skill 输入集合

[system-prompt.ts:121–177](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/system-prompt.ts#L121-L177) 根据 `skills.length > 0` 生成清单；随后只用非空自定义 section 覆盖。仅删除或清空 `sections.skills` 不能阻止原生生成。

[runner.ts:1411–1463](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/extensions/runner.ts#L1411-L1463) 把可变 `currentOptions` 交给 before_agent_start handler 并返回它。因此插件可设 `event.systemPromptOptions.skills = []`，另加有界路由 section，不必 force 替换整个 prompt。其他后置 handler 仍可能改写，不能保证独占最终请求。

## P2 — 独立模型调用与生命周期是公开能力

[model-registry.ts:132–143](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/model-registry.ts#L132-L143) 公开 `streamSimple(model, context, options)` 与 `complete`；[extensions/types.ts:851–908](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/extensions/types.ts#L851-L908) 定义 context、context_with_system、prompt options 和 provider 事件；[types.ts:985–1022](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/extensions/types.ts#L985-L1022) 区分 settled 与模型 turn_end。

插件采用独立单请求分析，不使用主会话 fork/navigateTree。SDK 可作为公开备选，但 [sdk.ts:58–81](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/sdk.ts#L58-L81) 的 `noTools` 是 `"all" | "builtin"`，不是 boolean；不采用子报告中带不存在 `ctx.settingsManager` 的示例。

## P3 — 分支状态与资源格式可复用

[session-manager.ts:245–263](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/session-manager.ts#L245-L263) 的只读接口包含 getBranch、buildSessionProjection、getHeader 等，而不是允许插件任意 append 私有条目。[src/index.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/index.ts) 导出 convertToLlm、buildSessionContext、loadSkills 等入口。

[官方 Skills 文档](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/docs/skills.md) 描述原生元数据清单、按需正文、显式 `/skill:` 和 reload。插件稳定标识与同名展示是新增索引契约，不把原生名称冲突规则说成项目必然覆盖全局。

## H1 — Hermes 的披露层次与发现过滤

[skill_utils.py:29–31](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/skill_utils.py#L29-L31) 将 references/templates/assets/scripts 视为 skill 支持目录，而非独立 skill；[skills_tool.py:573–640](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/skills_tool.py#L573-L640) 的 `skill_view` 支持具体 `file_path`。

目录读取与创建根由 [skill_utils.py:386–531](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/skill_utils.py#L386-L531) 的 create_dir、project root/trust 等辅助逻辑决定。可配置创建根不等于 per-operation project/global 参数；Pi 插件显式 scope 属于适配设计。不能沿用旧报告“只扫描一层”的结论。

## H2 — 后台所有权与写前读守卫

[skill_manager_guards.py:164–230](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/skill_manager_guards.py#L164-L230) 首先判断 `_is_background_review()`；仅此路径执行 curator-owned、pinned、external/bundled/hub 保护及当前审查读标记校验。缺失 provenance 不能当作自动可写。

这不是所有前台写操作无条件遵循的同一个守卫。本插件统一 store 权限、版本检查，以及对手装 skill 的 TUI/global grant，是根据用户要求建立的更明确契约。

## H3 — 当前快照与审查成本

[background_review.py:985–1080](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L985-L1080) 构造与父运行时对齐但不持久化聊天的 review agent；[1167–1213](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L1167-L1213) 实际传入：

```python
conversation_history=_digest_history(messages_snapshot) if _routed else messages_snapshot
```

不同模型路径的 [digest:324–355](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/agent/background_review.py#L324-L355) 是代码裁剪，不是增量审查，也不是另一次 LLM 总结。同模型同前缀只提供缓存复用条件；后台仍消耗 token。插件首版一次提案请求及明确预算是收敛设计，不声称完全复制 Hermes 多轮工具审查。

## H4 — 可追溯维护，而非自动删除即正确

[skill_ledger.py:569–630](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/skill_ledger.py#L569-L630) 提供 rollback_entry；[skill_manager_guards.py:241–262](https://github.com/NousResearch/hermes-agent/blob/234badf4012af380d23c91eae55d045a69c69ffb/tools/skill_manager_guards.py#L241-L262) 对 curator 合并删除设置 absorbed_into 检查。二者启发本插件备份、显式合并与恢复边界，不证明任意文件集拥有整体事务。

不把查看次数当成功使用，不依赖未核准的陈旧天数作为首版删除策略，也不照搬 cron 或组织市场功能。

## 覆盖与排除

| 首版能力 | 证据/决定 | 适配去向 |
| --- | --- | --- |
| 搜索及三级披露 | P1、P3、H1、U1 | skill-discovery / D2 |
| 项目/全局与授权写入 | H2、U1 | scoped-skill-management / D3–D4 |
| 隔离快照及可见费用 | P2–P3、H3、U1 | skill-reflection / D5、D7、review-contract R1–R7 |
| pin、维护、归档恢复 | H2、H4、U1 | skill-maintenance / D6 |

子研究报告保留在任务运行制品中，不作为直接规格依据；错误的仓库链接、成本百分比、原生优先级、未经执行的测试断言已排除。没有实测 provider cache 命中、账单、跨平台锁、完整插件运行；这些是后续验收，不是本轮通过项。OMD 覆盖这份首版清单，不宣称覆盖上游所有有价值细节。
