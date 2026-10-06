## MODIFIED Requirements

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
