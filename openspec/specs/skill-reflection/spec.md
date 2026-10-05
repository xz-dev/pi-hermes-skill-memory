# skill-reflection Specification

## Purpose

将任务中的可复用流程和纠正通过当前上下文快照审查形成技能提案，并对每次后台模型调用实施可见的费用准入、独立运行、取消和提交校验，避免隐藏失败、重复审查及无限重试造成不可感知的消耗。

## Requirements

### Requirement: Current-context snapshot review
默认审查 SHALL 使用主会话当前有效分支的上下文快照，包括已有压缩结果，不得暗中改为仅新增消息或重新加载全部原始历史。默认使用当前模型；安全隔离优先于缓存对齐，不承诺缓存命中。

#### Scenario: Compacted session
- **WHEN** 会话压缩后达到审查条件
- **THEN** 审查基于压缩后的有效快照及明确附加的相关 skill 版本，报告快照标识；不会自动恢复被压缩的全部历史

### Requirement: One explicit scheduling path
自动审查 SHALL 在前台本轮稳定结束后运行；用户轮次与模型/工具循环 SHALL 分别计数，重复生命周期事件不得重复派发。启动、压缩和退出钩子不得暗中另起收费总结。

#### Scenario: Long tool loop
- **WHEN** 用户只发出三次请求但模型运行四十个工具循环
- **THEN** 用户轮次仍为三，工具计数不能冒充四十次用户输入；同一稳定快照最多自动审查一次

### Requirement: Admission and cumulative budgets
每次后台调用 MUST 在发出前预留单任务及持久累计预算，限制请求数、输入、输出和时间；默认不得静默重试、换模型或转子进程兜底。预算不足时 SHALL 明确跳过而不收费，不通过隐式裁剪改变快照策略。

#### Scenario: Snapshot exceeds budget
- **WHEN** 当前完整有效快照超过输入预算
- **THEN** 显示 skipped-budget、估算量与允许值，不发请求；用户可在看到费用风险后手动调整或压缩主会话

#### Scenario: Invalid or empty model output
- **WHEN** 已收费请求返回无效结果、空内容或仅 reasoning
- **THEN** 记录本次用量和 no-proposal 或 failed 状态，不追加另一个模型/进程请求；有歧义的结果不提交文件

### Requirement: Failures and usage remain visible
TUI SHALL 持续显示运行、最近结果、累计用量/预算和未确认错误，并提供明细；失败、取消及无变更调用同样计费归因。缺失 usage 或价格 SHALL 显示 unknown，不能用零或成功通知覆盖。非 TUI 模式 SHALL 有结构化记录。

#### Scenario: No skill saved but tokens consumed
- **WHEN** 审查成功且决定无需保存
- **THEN** 用户仍看到 no-change、模型、调用次数和 input/output/cache 用量；该请求计入累计预算

#### Scenario: Disconnect after request submission
- **WHEN** 连接断开且服务端是否继续计费未知
- **THEN** 状态为 failed-usage-unknown，预算预留不释放为零，自动审查暂停，错误跨 reload 保留直到用户处理

### Requirement: Isolated lifecycle and stale-result rejection
审查 MUST NOT 改变主会话文件、leaf、工具集合或 UI 活动会话；新输入、分支/项目切换、关闭或取消 SHALL 撤销旧任务提交资格。迟到结果 SHALL 计量但不写入。

#### Scenario: New request supersedes review
- **WHEN** 审查进行时用户开始新任务或切换项目
- **THEN** 后台收到取消，主任务不等待它；旧结果即使返回也不更新 skill，其实际或未知用量仍被记录

### Requirement: Validated proposals and no recursive work
模型只 SHALL 提出带证据、适用范围、目标版本和变更理由的技能提案；宿主验证后使用统一写入入口。自动正文及简介 SHALL 限于绑定当前证据的来源引用或有限宿主模板，不用关键词包含判定任意改写的真实性。引用 SHALL 保留来源归因，不代表宿主认证执行成功。无法验证的自由改写及资产 SHALL 进入有界 pending，由用户审阅精确 diff 后本地批准；批准不冒称事实认证，不改变原请求计量，也不得再请求模型验证。内容验证与写权限 SHALL 分离，手装全局授权不能绕过内容门禁。审查不得加载自身自动化扩展或执行无关工具，拒绝、冲突和无结果不得触发新一轮审查。

#### Scenario: Unsupported assertion in a generated skill
- **WHEN** 模型把未运行的测试说成成功或提出无来源的全局约定
- **THEN** 提案不自动提交；有有效来源但正文无法证明时进入有界 pending，缺来源则失败，记录具体原因及用量，不追加验证请求

#### Scenario: Evidenced procedure without execution certification
- **WHEN** 当前用户证据明确要求构建后检查发布 manifest，模型选择宿主支持的流程模板
- **THEN** 宿主生成带来源的步骤并保存供后续搜索读取；不得生成测试通过或发布完成断言

#### Scenario: Local approval of unverified content
- **WHEN** 用户在实际 TUI 审阅 managed 或手装 pending 的精确目标、版本及逐成员 diff 后批准
- **THEN** 系统重新校验来源、项目、路径、权限和版本后本地提交，标为用户批准而非事实认证；不重放原请求或改写原计量

### Requirement: Independent operation and shared charging
skill 插件 SHALL 独立可用；与记忆插件共存时，同一快照 SHALL 合并目标、只发一次审查并只记一次总费用，各插件仅提交自身目标。协调或预算存储失效时 MUST 暂停自动收费，而非各自降级为独立付费。

#### Scenario: Both plugins become due
- **WHEN** 两插件对同一分支快照同时到期
- **THEN** 一个任务返回分类提案，两个消费者分别验证；用户看到一个总账及目标归属，而不是两次完整快照请求

### Requirement: Disable means no automatic model calls
关闭自动审查 SHALL 阻止全部自动提炼、维护、压缩前 flush 与退出总结的模型调用；手动读取与已批准提案的本地提交 SHALL 继续可用。

#### Scenario: Shutdown with automatic review disabled
- **WHEN** 用户关闭自动审查后退出或压缩会话
- **THEN** 只进行必要本地持久化，不发生任何隐藏模型调用

### Requirement: Learning usefulness is observable
系统 SHALL 将被准入、预算跳过、无提案、冲突、保存和后续复用分别报告；发布验收不得仅用低请求数或全部跳过证明自动学习成功。代表性正例 SHALL 贯通提案、保存及后续发现，真实模型质量与 fake-provider 流程验证分开报告。

#### Scenario: All useful snapshots are skipped
- **WHEN** 代表性正例都因初始预算被跳过，或审查只得到无效提案
- **THEN** 验收报告标为学习效用未达成并显示原因，提出有证据的参数调整供用户决定；不静默放宽预算，也不宣称自动学习完成
