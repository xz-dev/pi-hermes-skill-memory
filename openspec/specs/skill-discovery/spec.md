# skill-discovery Specification

## Purpose

为已安装和自动生成的全局、项目技能提供搜索优先的发现与分级读取，使模型只接收当前需要的内容，同时保持来源、作用域、显式加载及与官方 Pi 原生行为的关系可解释、可恢复。

## Requirements

### Requirement: Search-first progressive disclosure
系统 SHALL 默认仅向模型提供有界的 skill 使用指导与搜索入口，不注入全部 skill 元数据或正文；搜索结果仅含标识、名称、简介、作用域、来源和读取位置，正文及引用文件 SHALL 分别按需读取。指导 SHALL 要求 Agent 主动寻找适用技能，并在产生可复用纠正、排错经验或非平凡流程时判断是否创建或修订自己的受管笔记，而不是等待用户逐次要求保存；无新知识时 SHALL 允许不保存。

#### Scenario: Large installed collection
- **WHEN** 用户安装数千个 skill 并开始普通任务
- **THEN** 初始指导大小不随 skill 数量线性增长，搜索分页且有输出预算，未命中的正文不会进入模型上下文

#### Scenario: Read a supporting reference
- **WHEN** 模型读取某 skill 的 SKILL.md 后指定一个引用文件
- **THEN** 只返回该文件及必要来源信息，不自动递归展开所有 references、scripts 或 assets，也不执行其中脚本

#### Scenario: Proactive notebook guidance
- **WHEN** Agent 获得本任务的 skill 使用指导
- **THEN** 指导同时包含先搜索再使用、把可复用经验保存到受管笔记、先更新已有笔记以及尊重用户安装技能权限；不要求用户运行管理命令才能启动普通学习

### Requirement: Scope and ownership are separate
系统 SHALL 为每个可见 skill 保存稳定且不歧义的标识、真实来源、项目或全局作用域及管理权限；来源不决定是否可以按需读取，作用域不等于修改授权。

#### Scenario: Same name in multiple scopes
- **WHEN** 项目与全局目录都有同名 skill
- **THEN** 搜索显示两者与各自标识，项目相关结果优先但不得静默覆盖全局实体；显式读取标识始终选中指定实体

### Requirement: Respect native exclusions and project trust
系统 SHALL 尊重官方 Pi 已生效的资源排除和项目信任结果；被排除的路径不得因插件另行扫描而重新暴露。仅允许显式加载的 skill SHALL 不出现在自动推荐中，但保留用户显式入口。

#### Scenario: Untrusted or disabled source
- **WHEN** 项目未获信任或某 skill 被用户在 Pi 中禁用
- **THEN** 插件不自动加载或恢复该 skill，并报告排除原因而不是将其当作不存在的缓存错误

### Requirement: Complete CLI and SDK source snapshots
系统 SHALL 在官方 CLI 与接入插件的 SDK 宿主中完整保留去重前的最终允许来源，包含作用域、来源、显式加载资格与排除诊断。SDK 宿主 SHALL 通过公开来源回调提供自己的最终过滤结果；插件 MUST NOT 用配置解析结果猜测宿主的运行时排除，也不得读取 Pi 私有字段或安装缺失包。

归档后的文件可能不在当前 Skill[] 中；恢复 SHALL 另外取得宿主针对原路径、scope/项目/来源身份的当前允许决定。SDK 使用窄的可选恢复授权回调，未接入时明确阻止恢复而不影响普通搜索读取；旧归档记录、全局手装修改授权和用户恢复命令都不能替代当前来源授权。

#### Scenario: SDK exposes duplicate names and runtime exclusions
- **WHEN** SDK 宿主提供两个允许的同名来源，并排除另一个来源或设置 noSkills
- **THEN** 允许的来源分别可搜索和读取；排除项不出现，noSkills 的空允许集不被配置扫描补回

#### Scenario: Source refresh fails or changes project
- **WHEN** 来源回调失败、协议版本不符或返回旧项目的来源
- **THEN** 插件清除旧索引，显示具体来源错误并阻止依赖该来源的自动写入，不以旧内容或全盘扫描假装成功；原生入口仍保留

### Requirement: Explicit loading and native fallback
系统 SHALL 保留按稳定标识的显式加载命令，并提供恢复原生目录呈现的模式；插件不得通过重写整个系统提示而抹除其他扩展或项目指令。

#### Scenario: Search misses a known skill
- **WHEN** 搜索未命中但用户显式提供可访问 skill 标识
- **THEN** 系统直接加载该 skill，不依赖模型再次猜关键词

#### Scenario: Plugin disabled
- **WHEN** 用户禁用插件并重载 Pi
- **THEN** 官方 Pi 仍能发现标准 SKILL.md 文件，原生同名处理规则恢复，插件不留下强制禁用原生扫描的设置

### Requirement: Version-aware reads and refresh
读取结果 SHALL 含版本依据；生成或修改成功后插件索引 SHALL 失效并刷新。目录错误、无效 frontmatter 和过期记录 SHALL 可见，不得用旧内容冒充本次成功读取。

#### Scenario: External edit after a read
- **WHEN** 用户在读取后手改目标文件
- **THEN** 下一次读取显示新版本，基于旧版本的修改被拒绝；插件明确说明原生 slash 自动补全可能需官方 reload 才更新

### Requirement: File containment
系统 MUST 拒绝读取超出选定 skill 根的引用路径及符号链接逃逸，且不得将检索到的第三方文档提升为系统授权。

#### Scenario: Escaping reference
- **WHEN** 引用路径含目录穿越或链接到 skill 根之外
- **THEN** 读取失败并说明边界，没有根外文件内容被送给模型

### Requirement: Related notes use existing metadata search
补充笔记 SHALL 是普通受管 skill，由 AI 在名称、描述和正文中表达原技能及适用情境；用于发现的原技能名称和任务关键词 SHALL 出现在名称或描述中。发现 SHALL 复用现有大小写不敏感的名称/描述关键词搜索及范围筛选，不新增关系字段、父子标识、关联表、关系索引、向量检索或强制联合加载。正文中的自然语言提及 SHALL 不被当作修改原技能的权限，也不承诺正文可被当前搜索检索。

#### Scenario: Find a note by original skill name
- **WHEN** AI 创建描述中包含 `github-pr-workflow` 和本项目适用条件的受管笔记，随后搜索 `github-pr-workflow`
- **THEN** 在允许来源和输出预算内可发现该笔记；读取它不要求存在任何结构化关联记录

#### Scenario: Read the original without concatenation
- **WHEN** 用户或 Agent 只读取原技能
- **THEN** 仅返回指定内容，不强制拼接补充笔记；Agent 可按正常搜索和按需读取流程选择使用相关笔记

#### Scenario: Similar names do not grant access
- **WHEN** 另一个项目或来源存在同名技能或补充笔记
- **THEN** 搜索仍区分范围和稳定身份，Agent 判断适用性；名称相似不使该实体继承另一技能的白名单授权
