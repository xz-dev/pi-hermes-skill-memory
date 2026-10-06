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
TUI SHALL 在用户显式查询 status、usage 或 errors 时显示运行、最近结果、累计用量/预算和未确认错误，不常驻状态栏或面板；失败、取消及无变更调用同样计费归因，记录和安全暂停跨 reload 保留。缺失 usage 或价格 SHALL 显示 unknown，不能用零或成功通知覆盖。非 TUI 模式 SHALL 有结构化记录。

#### Scenario: No skill saved but tokens consumed
- **WHEN** 审查成功且决定无需保存
- **THEN** 用户查询 status/usage 时仍看到 no-change、模型、调用次数和 input/output/cache 用量；该请求计入累计预算

#### Scenario: Quiet interface with explicit status
- **WHEN** 扩展加载、reload 或后台审查状态变化
- **THEN** 不自动创建常驻状态栏或面板；显式 status 可查询费用、暂停、权限、待审批及未完成维护，账本错误仍阻止收费调用

#### Scenario: Disconnect after request submission
- **WHEN** 连接断开且服务端是否继续计费未知
- **THEN** 状态为 failed-usage-unknown，预算预留不释放为零，自动审查暂停，错误跨 reload 保留直到用户处理

### Requirement: Isolated lifecycle and stale-result rejection
审查 MUST NOT 改变主会话文件、leaf、工具集合或 UI 活动会话；新输入、分支/项目切换、关闭或取消 SHALL 撤销旧任务提交资格。迟到结果 SHALL 计量但不写入。

#### Scenario: New request supersedes review
- **WHEN** 审查进行时用户开始新任务或切换项目
- **THEN** 后台收到取消，主任务不等待它；旧结果即使返回也不更新 skill，其实际或未知用量仍被记录

### Requirement: Validated proposals and no recursive work
模型只 SHALL 提出带有效来源证据、适用范围、目标版本和变更理由的技能提案；宿主完成结构、证据绑定、范围、来源权限、路径及版本校验后使用统一写入入口。自由归纳的正文、描述和支持文件 SHALL 可作为 AI 笔记自动保存，不再以宿主有限模板或逐字引用作为通用内容准入条件；系统 SHALL 保留来源并标明归纳性质，不把保存、引用或用户批准当作独立事实认证。模型指导 SHALL 区分来源报告、建议流程和有实际依据的执行结果，不将未执行的测试描述为已验证。缺来源、非法路径、无效结构或版本冲突 SHALL 拒绝，不以白名单或 YOLO 豁免。内容来源校验和手装写权限 SHALL 分离；不得为认证正文、修复拒绝或完成转写暗中新增验证模型或重复审查。审查不得加载自身自动化扩展或执行无关工具，拒绝、冲突和无结果不得触发新一轮审查。

#### Scenario: Unsupported assertion in a generated skill
- **WHEN** 模型提交没有有效来源的全局约定或执行成功断言
- **THEN** 提案因缺乏有效来源失败并记录用量，不追加验证请求；对于有真实来源的自由归纳，系统只标记为模型笔记，不声称已证明其断言

#### Scenario: Evidenced procedure without execution certification
- **WHEN** 当前用户证据明确要求构建后检查发布 manifest，模型据此提出流程
- **THEN** 带来源的流程可保存并被后续搜索读取，无需选择唯一宿主模板；保存不生成测试通过或发布完成认证

#### Scenario: Local approval of unverified content
- **WHEN** 用户在实际 TUI 审阅历史 managed 或手装 pending 的精确目标、版本及逐成员 diff 后批准
- **THEN** 系统重新校验来源、项目、路径、权限和版本后本地提交，标为用户批准而非事实认证；不重放原请求或改写原计量，升级不自动执行这类旧请求

#### Scenario: New ordinary lesson outside the old template
- **WHEN** 已准入的审查产生有来源的中文排错笔记及支持文件，不属于旧固定模板
- **THEN** 在其余门禁通过时保存到允许的受管目标并可被再次发现，不进入人工内容审批，不添加第二个模型请求

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

### Requirement: Automatic learning defaults on without overriding saved choices
新安装以及没有持久化开关选择的状态 SHALL 默认启用后台自动学习，无需用户执行 enable 或先审批普通笔记。已有持久化 true 或 false SHALL 保留，暂停原因、未知用量预留、历史用量和去重依据 SHALL 不被默认值迁移清除。默认开启 SHALL 仍只沿用现有前台稳定结束后的唯一调度路径，不在安装、启动、压缩或退出时立即发出额外总结；关闭后 SHALL 持续阻止自动模型请求。

#### Scenario: Fresh installation learns without enable
- **WHEN** 新用户未设置自动学习开关，前台达到既有正常审查条件且预算、来源及协调状态允许
- **THEN** 自动派发一次当前有效快照审查，不要求先运行 enable；加载插件本身不立即发出请求

#### Scenario: Upgrade preserves off and pauses
- **WHEN** 旧状态保存了 false，或有暂停原因和 usage-unknown 预留
- **THEN** false 仍为关闭，暂停仍阻止派发，预留和费用记录原样保留；默认开启不能绕过任何一项

#### Scenario: Unset is not a ledger failure
- **WHEN** 账本损坏、曾初始化的文件丢失或旧请求恢复尚未处理
- **THEN** 系统保持明确错误和禁止收费状态，不把读取失败当成“没有选择”而默认开启新调用

### Requirement: Redirection does not create a hidden review
全局仅笔记策略或单次转写决定 SHALL 保留原技能并复用正常前台学习或已准入审查来构造受管提案。系统 SHALL 向 Agent 提供足够的当前策略及搜索入口，使其优先寻找已有受管笔记。转写、拒绝、无结果和审批本身 SHALL 不隐式派发第二次后台调用，不把同一候选同时直接更新原件和保存替代笔记。缺少有效受管候选时 SHALL 明确返回需要继续提炼的转写结果，不机械复制整个原 skill、不冒称保存成功；前台 Agent 可在正常交互中继续搜索和提交，不要求用户手工复制内容。

#### Scenario: Notes-only review
- **WHEN** 目标不在白名单且全局为仅笔记，当前已有一次获准审查
- **THEN** 同一次审查据策略生成或修订受管笔记，原件不变，总后台请求数仍为一；无有效笔记时如实报告无保存或转写待继续

#### Scenario: Redirect without a prepared note
- **WHEN** 用户选择单次转写，但现有结果没有可直接提交的受管候选
- **THEN** 本地返回转写意图、原目标和可供 Agent 继续搜索的上下文，不额外调用后台模型，也不把原有执行状态或用量改成“已保存”

#### Scenario: One selected destination
- **WHEN** 同一内容改进有原件修改和受管替代两种候选
- **THEN** 按最新策略和用户决定只选择一条提交路径，每条仍重验自己的来源、作用域、目标版本和资格
