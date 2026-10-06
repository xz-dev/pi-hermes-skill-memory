# 使用与恢复

## 状态与兼容边界

这是面向官方 Pi **0.99.2** 验证的 repo-local 插件。单独使用不需要 memory 插件、xz fork 或 pi-subagents。尚未向个人环境安装或发布。

**当前 memory 仓不是已验证兼容的协作方。**两仓费用规则和账本实现不同；不要把协议替身通过理解为可直接同时开启两仓自动学习。详见[可选协作](review-cooperation.md)。

## 从只读开始

加载本扩展后，没有保存开关选择的合法状态默认开启自动学习；已有 false、暂停和未知用量预留均保留。损坏、不可读或初始化后丢失不是“未设置”，仍禁止计费。加载本身不请求模型。搜索/读取不调用辅助模型；主代理正常对话和工具后续轮次仍有费用。只有替代入口和当前允许来源均可用时，才撤下原生全量skills目录。没有常驻状态栏或面板：显式 `/hermes-skills status` 查询来源、权限、pending与未完成维护，`/hermes-review status`、`usage`、`errors` 查询审查与费用。隐藏展示不清除错误、未知预留或安全暂停。

```text
/hermes-skills status
/hermes-skills refresh
/hermes-skills mode native
/hermes-skills mode search
```

模型工具是 `hermes_skill_search`、`hermes_skill_view`、`hermes_skill_manage`。正文与引用按需分页，返回稳定SkillId和版本。显式加载：`/hermes-skills load <SkillId> [nextOffset]`。不执行读取到的脚本。

## 启用、暂停和关闭

```text
/hermes-review enable
/hermes-review status
/hermes-review usage
/hermes-review pause
/hermes-review disable
```

非Git项目首次写入/启用时，TUI要求明确选择项目根。SDK宿主可提供已核验的projectRoot，Git worktree身份不能被父目录覆盖。

`enable`用于重新启用用户曾关闭的开关，不是新安装前提。每10个含工具的模型轮次到期，但只在前台稳定结束后捕获当前有效上下文。默认同模型、一次请求、64k输入/4096输出/90秒；UTC日4任务/256k输入/16384输出。UTF-8字节预算是保守估算，不是实际token数或账单保证。超预算明确跳过，不截取增量、不自动换模型或补发。

`pause`阻止新审查并撤销当前任务的提交资格；`disable`还持久关闭自动化。新输入/切换/reload/shutdown同样撤销旧资格。只读查询和合法本地恢复仍可用。取消不是远端免费保证；迟到usage只归原request。

遇到失败先看 `errors`、`usage`。`resume`只确认错误、解除暂停，不清零未知预留、不开启自动化；`retry`是一次新的计量请求，须看到旧费用并明确确认。不要通过编辑/删除账本恢复额度。

## 修改与维护

- 普通有有效证据的 AI 归纳正文、描述与合法支持文件自动保存，记录为 `agent-notes`；名称/描述不会因出现 passed 或旧模板措辞被替换。保存不认证任意事实、测试成功或新权限。显式来源摘录、旧模板及历史批准/恢复记录保持兼容。
- 手装来源保持 user-owned。用户策略为询问（默认）、YOLO、仅笔记；具体稳定 SkillId 白名单优先。`/hermes-skills settings`按需选择策略、查看/移除白名单，无常驻面板。模型、项目设置或笔记不能改权限。
- 实际TUI审阅冻结精确逐成员差异，选择允许本次、始终允许此技能、本次不修改、保留原版记入笔记。取消或编辑审阅载荷不授权；拒绝不转写，同轮同目标不反复询问。后台等待安全的空闲TUI输入，不抢占前台或补发审查；Print/RPC 的 hasUI 不能授权。
- `pending` → `approve <id>` / `reject <id>`保留为高级/历史处理入口，不是普通笔记必经流程。一次批准不改所有权；`installed allow --acknowledge` / `installed deny`是明确用户命令别名，对应 allow/ask。所有提交重新检查撤权、来源、pin、只读、路径与读取版本；仅笔记明确阻止手装归档、恢复、回滚与剩余成员恢复。
- 转写结果区分已保存 ID 和未保存意图。Agent 先按原技能名称/任务词搜索受管笔记，实际读取版本后修订或创建，不能机械复制原技能；可读的 pinned/只读原件可引出独立可写笔记，排除来源不能绕读。搜索仅匹配名称/描述，不搜索正文、不保证语义召回，无父子字段/关系表/强制拼接。全局技能的项目经验不升级为全局。
- 后台单次响应支持 `{proposal, managedAlternative?}`，原有平面提案兼容；这是有界操作候选，不是持久技能关系。两候选先校验，按策略/决定只走一个提交路径；没有已读候选版本不能覆盖，没有候选如实待继续，不增加模型请求或验证模型。
- `inspect <id>`、`pin/unpin <id>`、`use <id> <reason>`、`outcome <id> success|failure <reason>`。模型reported与用户confirmed分栏，不以查看次数证明成功。
- `curate list`免费；`curate propose <keep-id> <absorb-id>`明确计量；`curate apply <pending-id>`本地精确批准，保留被吸收内容。见[语义合并](curation.md)。
- `history <id>`、`rollback <id> <change-key>`、`archive <id> <reason>`、`archives`、`restore <archive-id>`。无永久purge，不覆盖后续手改；共享引用不随手装主文件移走。

未决store事务使用 `/hermes-review recovery` 和 `recover <key> commit|abort`；已提交成员不能假abort。归档中断用 `archive-resume <archive-id>`；合并先处理列出的store子事务，再重复本地apply。原请求不重放，未知费用不释放。详见[维护恢复](maintenance-evidence.md)。

## 验证边界

当前公共工具保存→元数据搜索→读取→同身份新证据修订、默认开启确定性provider、真实隔离TUI四选项/取消/设置与费用观察见[笔记验收证据](notebook-evidence.md)。不保证缓存命中；未运行付费实模，不证明长期学习质量、真实账单或真实memory互操作。

## SDK与禁用扩展

从本项目 `src/index.ts` 使用 `createSkillsExtension({agentDir, skillSources, projectRoot?, restorePolicy?})`。`skillSources`必须返回宿主去重前的最终允许来源及身份/信任/诊断，不能用配置推测隐藏的运行时排除。`restorePolicy`只控制已归档缺失路径的当前恢复许可，未提供只阻恢复，不影响普通读取。宿主应正确退役旧项目session。

CLI默认入口只在确认官方CLI后使用公共解析器；不安装缺包。临时缓存路径恢复布局只核验0.99.2，未知版本fail closed。

要完全禁用插件，从扩展加载列表移除本入口并重启/reload。标准SKILL.md仍可由官方Pi发现；不会留下强制禁用原生扫描的设置。保留账本、pending和备份，不自动迁移旧个人资料。
