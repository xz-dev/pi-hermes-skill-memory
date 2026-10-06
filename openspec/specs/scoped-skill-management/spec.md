# scoped-skill-management Specification

## Purpose

在全局和项目范围内可靠生成与更新技能，明确区分插件受管、用户安装与不可写来源，并以具体差异授权、版本检查和可恢复记录保护用户已有内容，避免自动学习覆盖人工维护成果。

## Requirements

### Requirement: Explicit generation scope
创建 SHALL 指明 project 或 global；由当前仓库特有路径、规则或环境得出的技能 SHALL 默认选择 project，只有具有跨项目适用证据的提案才能选择 global。创建、迁移不得静默覆盖同名实体。

#### Scenario: Project-specific correction
- **WHEN** 用户纠正了当前仓库独有的发布步骤
- **THEN** 生成提案指向该项目，并保留来源；不会把这一规则自动写入所有项目可见的全局技能

#### Scenario: Promote an existing skill
- **WHEN** 用户请求将项目技能提升为全局
- **THEN** 系统展示适用范围变化与目标冲突，保留旧版本和迁移记录；未经该请求的后台提炼不自行迁移

### Requirement: Managed ownership requires evidence
系统 SHALL 仅将具有本插件创建记录和匹配身份的 skill 认定为受管；未知来源、缺失管理记录、手动安装、包安装和外部路径 SHALL 默认视为用户拥有。受管 AI 笔记在来源证据、适用范围、内容结构、路径与目标版本校验通过后 SHALL 可自主创建或更新，包括自由归纳的正文、描述和支持文件，不得仅因不属于来源摘录或固定模板而要求人工内容审批。保存 SHALL 保留模型归纳及来源的属性，不等于事实或执行成功的认证；任何自动写入 MUST NOT 绕过 pin、只读源或文件系统权限。

#### Scenario: Ownership record missing
- **WHEN** 目标文件存在但管理记录缺失
- **THEN** 系统不根据目录名称推断其可自动写入，而转入用户安装来源的授权流程

#### Scenario: Ordinary synthesized notebook
- **WHEN** AI 根据当前有效证据提交中文排错总结及有界支持文件，且目标是可写的受管 skill、版本和路径均有效
- **THEN** 系统自动保存并保留来源和历史，不因它不是固定模板或逐字引用而进入人工 pending，也不宣称宿主已验证总结中的所有结论

### Requirement: Authorize installed-skill mutations
修改用户安装 skill 的任何正文、引用或归档位置 MUST 满足独立于内容来源校验的用户授权策略。全局策略 SHALL 为询问后修改、自动允许修改（YOLO）、保留原版仅写受管笔记之一，默认询问；单技能持久允许白名单 SHALL 优先于全局策略。白名单和 YOLO SHALL 不改变 user-owned 身份，也不绕过当前来源、范围、pin、路径、版本及恢复保护。项目配置、skill 内容、模型输出和后台子任务 MUST NOT 授予或扩大此权限；撤销授权 SHALL 在提交前重新检查。

#### Scenario: TUI approval
- **WHEN** 目标不在白名单、全局为询问，且前台请求修改手装 skill
- **THEN** TUI 显示技能名称、目标身份、作用域、修改理由、版本和完整逐成员差异，并提供允许本次、始终允许此技能、本次不修改、保留原版并写受管笔记四种决定；不用用户复制内部标识

#### Scenario: Unattended proposal without grant
- **WHEN** 后台或无真实 TUI 的模式提出手装更新，目标不在白名单且全局为询问
- **THEN** 不写原件；保存有界待决请求以供安全的前台交互或显式查询处理，不把没有回应或宿主声称有 UI 当作授权，不为等待决定重复调用模型

#### Scenario: Global grant
- **WHEN** 用户明确设置 YOLO 且目标没有其他保护或冲突
- **THEN** 带有效来源的更新可无弹窗提交，包括不属于固定模板的 AI 归纳；仍保存来源、差异与恢复版本，不声称内容已经获得事实认证

#### Scenario: Allowlist wins over notes-only policy
- **WHEN** 全局为保留原版仅写笔记，而当前具体技能在用户允许白名单中
- **THEN** 允许对该技能提交通过其余门禁的直接更新；同名但不同身份的技能不继承此权限

#### Scenario: Keep original policy
- **WHEN** 全局为保留原版仅写笔记且目标不在白名单
- **THEN** 手装原件字节和位置不变；内容改进转为搜索、更新或创建普通受管笔记，不需要用户逐次选择第四项；不适合转写的归档、恢复等位置操作被明确阻止而不虚报完成

#### Scenario: Protected original with a writable notebook
- **WHEN** 全局仅笔记策略适用，原技能当前允许读取但为只读或 pinned，另有可写且未受保护的受管保存目标
- **THEN** 原件保护保持生效，但不阻止在独立受管目标记录经验；实际受管目标仍须通过自身来源、路径和版本检查，被排除的原来源不能借转写被重新读取

#### Scenario: Policy changes after a one-time decision
- **WHEN** 用户在询问模式批准一次差异后、提交前将全局改为仅笔记，且目标不在白名单
- **THEN** 旧一次批准不能绕过新的仅笔记策略，原件不提交，返回未保存或转写结果

#### Scenario: Grant revoked while preparing a write
- **WHEN** 提案准备期间用户移除白名单项或撤销 YOLO，且没有本次精确差异批准
- **THEN** 提交按最新策略重新判定，旧许可不能继续写入；策略变为询问或仅笔记时返回对应的未提交或转写结果

### Requirement: Read and compare before mutation
后台更新 MUST 基于已读取的目标版本；所有写入 SHALL 在提交时检查来源身份、路径范围及版本，任何冲突均保持原文件不变，不触发付费自动修复。

#### Scenario: Concurrent user edit
- **WHEN** 审查读取版本 A 后用户改成 B
- **THEN** 对 A 的补丁被拒绝并显示 conflict，不覆盖 B，也不自动再调用模型

### Requirement: Durable and recoverable writes
有效变更 SHALL 保存可追溯的前后版本和来源；单文件替换 SHALL 避免部分内容可见，多文件操作 SHALL 在中断后明确报告已提交和未提交的成员，而不是虚称全部成功或全部回滚。

#### Scenario: Failure during asset update
- **WHEN** 更新 SKILL.md 和引用文件时发生 I/O 错误
- **THEN** 系统保留恢复依据，报告实际提交成员，停止后续自动写入并显示失败

### Requirement: Installation is not generation
系统 SHALL 管理已有来源与生成内容，但不得把生成 skill 自动变成包安装、依赖安装、远程发布或脚本执行；第三方包更新冲突 SHALL 保留用户本地修改并要求处理。

#### Scenario: Generated script needs a dependency
- **WHEN** 新 skill 包含依赖额外工具的脚本
- **THEN** 记录依赖和使用条件，不自动安装或执行，也不宣称脚本已通过实机验证

### Requirement: Four decisions have distinct effects
手装内容修改的四选项 SHALL 有明确且不同的效果。允许本次 SHALL 仅授权展示过的目标、版本和精确差异；始终允许 SHALL 将具体技能加入持久白名单并尝试同一份修改；本次不修改 SHALL 终止该项修改且不自动转写它；保留原版并写笔记 SHALL 仅改变本次改进的保存目标，不自动变更全局策略或建立持久拒绝名单。关闭或取消选择 SHALL 不产生授权、白名单项或文件修改。同一交互轮次的同一已拒绝目标修改 SHALL 不反复询问，用户明确重提除外。

#### Scenario: Allow once and then propose a different change
- **WHEN** 用户允许当前精确差异，之后同一技能出现另一份修改提案
- **THEN** 原批准不能用于新差异，技能未被加入白名单

#### Scenario: Always allow and revoke later
- **WHEN** 用户选择始终允许，随后 reload，并通过用户设置移除该技能
- **THEN** reload 保留授权，移除后恢复全局策略；白名单只改变修改授权，不改变技能所有权

#### Scenario: Reject without redirect
- **WHEN** 用户选择本次不修改
- **THEN** 原件保持不变，该提案不被改名后自动存成受管笔记，也不在同一交互轮次再次弹出相同目标的修改请求

#### Scenario: Redirect one proposal
- **WHEN** 用户选择保留原版并写受管笔记
- **THEN** 本次内容改进交给受管笔记流程，原件保持不变；结果区分真正保存、需要继续提炼、冲突或失败，不把转写意图当作保存成功，不改变全局模式

### Requirement: User-controlled policy and compatible permission migration
系统 SHALL 提供按需打开的用户设置入口，展示三态全局策略、具体允许技能及移除白名单操作；模型工具不得修改这些设置。已有全局布尔授权 SHALL 兼容迁移：true 对应 YOLO，false 对应询问，空白新状态对应询问且白名单为空。旧待审批、部分提交和恢复记录 SHALL 保留，不因升级被自动批准、执行或丢弃。损坏、缺失但曾初始化的记录 SHALL 明确阻止权限敏感写入，不重建为默认许可。

#### Scenario: Upgrade legacy permission state
- **WHEN** 旧记录有全局 true 或 false 以及尚未完成的待审批操作
- **THEN** 新策略保留原授权强度，待决和恢复依据不丢失；迁移本身不执行旧提案或触发模型调用

#### Scenario: Model asks for broader access
- **WHEN** 模型输出、项目配置或 skill 正文请求开启 YOLO 或添加白名单
- **THEN** 这些内容不能改变用户设置，原写入策略保持生效
