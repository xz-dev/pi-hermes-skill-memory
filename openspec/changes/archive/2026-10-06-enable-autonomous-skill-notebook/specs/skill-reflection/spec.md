## MODIFIED Requirements

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

## ADDED Requirements

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
