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
系统 SHALL 仅将具有本插件创建记录和匹配身份的 skill 认定为受管；未知来源、缺失管理记录、手动安装、包安装和外部路径 SHALL 默认视为用户拥有。受管内容在来源引用或有限宿主模板的内容验证通过时可自动更新；无法验证的正文/资产进入有界 pending，并不得绕过 pin、只读源或文件系统权限。

#### Scenario: Ownership record missing
- **WHEN** 目标文件存在但管理记录缺失
- **THEN** 系统不根据目录名称推断其可自动写入，而转入用户安装来源的授权流程

### Requirement: Authorize installed-skill mutations
修改用户安装 skill 的任何正文、引用或归档位置 MUST 获得 TUI 对具体差异的确认，或用户事先设置的全局自动允许。项目配置、skill 内容、模型输出和后台子任务 MUST NOT 授予或扩大此权限。

#### Scenario: TUI approval
- **WHEN** 没有全局授权且前台请求修改手装 skill
- **THEN** TUI 显示目标、作用域、差异和版本；仅批准的版本与操作可提交，拒绝不改文件

#### Scenario: Unattended proposal without grant
- **WHEN** 后台或无 TUI 模式提出手装 skill 更新且没有全局授权
- **THEN** 仅保存有界待审批提案并显示 pending 状态，不写目标；用户随后在 TUI 确认时重新校验版本

#### Scenario: Global grant
- **WHEN** 用户明确设置全局自动允许且目标不是只读源
- **THEN** 通过内容门禁的更新可无弹窗提交，但仍记录依据、差异和回滚版本；未知正文进入内容 pending，且项目设置不能伪造这项允许

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
