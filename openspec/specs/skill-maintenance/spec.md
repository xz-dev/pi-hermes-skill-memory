# skill-maintenance Specification

## Purpose

保持长期技能集合可理解、可追溯和可恢复，通过真实使用证据、保护标记及受控维护处理重复或失效内容，而不是把读取次数、文件时间或模型建议直接当作可删除用户知识的充分依据。

## Requirements

### Requirement: Evidence distinguishes viewing from success
系统 SHALL 分开记录发现、读取、修改及有明确结果依据的使用反馈；仅被打开不代表任务成功。统计记录 SHALL 有来源，不被后台审查自己的读取无限抬高。已有单次审查中的模型使用/结果报告 SHALL 绑定当前已读 SkillId/version 与有效引用，明确为未独立认证的 reported 统计，与用户显式 confirmed 结果分栏；不得为统计新增模型请求。同一报告的历史去重指纹 SHALL 持久保留，不因展示日志淘汰而重复计数。

#### Scenario: Skill read but task fails
- **WHEN** Agent 读取 skill 后任务失败
- **THEN** 系统记录读取与失败证据，不将该技能的成功使用计数增加

#### Scenario: Reported success is not user confirmation
- **WHEN** 原审查返回带有效引用和已读版本的成功报告
- **THEN** 只增加 reportedSuccess，不增加 confirmedSuccess；公开 inspect 可追查来源与原 request，只有用户显式结果命令增加确认计数

#### Scenario: Replay beyond the recent journal
- **WHEN** 已登记报告在超过4096个后续回执和本地重启后再次出现
- **THEN** 持久指纹阻止重复计数；展示日志可有界淘汰，但不能清空累计计数或去重历史

#### Scenario: Statistics cannot disable reading or protection
- **WHEN** 统计容量或写入失败
- **THEN** 允许的技能仍可读取并显示统计未记录告警，不冒称统计完整；用户仍可显式 pin/unpin，保护政策不占统计容量

### Requirement: Protected skills resist automation
pin、用户拥有和只读来源 SHALL 受保护；自动维护不能因低使用量、旧 mtime 或新生成替代项而归档或合并这些技能。

#### Scenario: Rare but pinned procedure
- **WHEN** 某 pinned 技能长期未被查看
- **THEN** 它仍可被搜索，不被自动归档，状态明确显示保护原因

### Requirement: Reviewable curation
维护 SHALL 提供 list、inspect、pin、propose、apply、archive、restore 和 rollback 的可观察入口。确定性统计不调用模型；语义合并属于明确计费的审查任务并使用相同预算门禁。默认老化只标记候选，不自动永久清理。

#### Scenario: Duplicate candidates
- **WHEN** 两个受管 skill 可能重复
- **THEN** 系统呈现合并理由、差异和保留内容；不能只因名称相似直接删除一个

### Requirement: Reversible archive and guarded rollback
归档 SHALL 保留内容、来源与恢复索引，并从默认搜索中移除；恢复和回滚 SHALL 检查新文件冲突，不覆盖之后的人工变更。首版不提供自动永久删除。

#### Scenario: Rollback after subsequent edit
- **WHEN** 用户请求回滚，但目标在被回滚操作后又被手改
- **THEN** 系统拒绝直接覆盖并显示冲突，保留两个版本供用户处理

### Requirement: Scoped knowledge remains scoped
维护 SHALL 保留技能的项目适用范围、前提与纠正理由；不得把任务流水账追加成无限增长的 skill，也不得把一次项目纠正转为全局命令。AI 的日常笔记维护 SHALL 先搜索并读取适用的已有受管技能，优先修订现有规则而非重复创建；对同一问题的旧结论 SHALL 根据新证据纠正，保留可追溯历史。由手装技能引出的补充笔记 SHALL 通过普通名称、描述和正文表达关联，不要求用户维护关联关系或逐条审批受管内容。

#### Scenario: Repeated lesson
- **WHEN** 新任务再次确认已有教训
- **THEN** 系统加强或修订同一规则，保留新证据，而不是新增重复技能或每次创建一份日期命名引用

#### Scenario: Revise an existing related note
- **WHEN** AI 搜索发现适用于当前项目的受管补充笔记，并得到纠正其中旧建议的新证据
- **THEN** 读取当前版本后更新该笔记，保留来源和恢复版本；不新增重复条目、不修改未授权手装原件，也不新增结构化关系

#### Scenario: Global reference with local lesson
- **WHEN** 使用全局安装 skill 时得到仅适用于当前仓库的经验
- **THEN** 新笔记默认保留在项目范围，不因为原技能全局可见或进入白名单就升级为全局规则

### Requirement: Maintenance results are durable and visible
每次维护 SHALL 报告 changed、no-change、pending、conflict 或 failed，列出作用域和恢复入口；涉及模型的维护 SHALL 出现在统一费用视图，而不因通过手动命令启动而漏记。前台工具结果和按需 status/usage/errors SHALL 足以区分原件更新、受管笔记保存、待用户决定及转写待继续，不恢复常驻状态栏或面板。普通受管笔记的更新 SHALL 不依赖用户手动维护 pending 队列；历史待决操作与真正需要手装授权的请求仍保留可处理入口。

#### Scenario: Curation model fails
- **WHEN** 用户运行语义合并后模型请求失败
- **THEN** 原技能保持不变；失败与已消费或未知用量持久保存并可按需查询，不只显示一个“维护完成”通知

#### Scenario: Inspect a redirected improvement
- **WHEN** 用户查询一次转写改进的处理结果
- **THEN** 可以区分原件未变、受管目标是否真正保存以及失败或冲突原因；只有已经提交的目标才显示 changed 或 saved，拒绝和转写意图本身不冒充成功
