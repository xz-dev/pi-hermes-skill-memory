## MODIFIED Requirements

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

## ADDED Requirements

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
