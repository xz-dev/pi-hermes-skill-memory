# 实现与验收追溯

## 自主笔记 change（已归档）

`enable-autonomous-skill-notebook` **19/19** 已完成并通过独立复核。父级最终复跑 **225/225** 测试、类型检查、严格 OpenSpec 与 diff 检查，1858个文件与获批候选一致；最终回执保留在 `/var/tmp/hermes-notebook-apply-YQDvYf/pickup-final-ut7BD7/`。实现阶段的分层验证见[笔记证据](notebook-evidence.md)，其中207项及活动 change 命令是当时的历史检查点，不是归档后的最新结果。

2026-10-06 经用户确认，将四份 delta 的6条修改、5条新增要求同步到[主规格](../openspec/specs/)，保留原有 Purpose 和未涉及场景；变更归档至[自主笔记归档](../openspec/changes/archive/2026-10-06-enable-autonomous-skill-notebook/)。源代码和测试保持获批版本不变。OMD仅迁移四个已跟踪 delta 文件的位置，保留链身份、范围及201条关系，不新增关系或把元数据健康视为业务证明。当前归档路径与检查回执见[笔记追溯回执](notebook-traceability.json)。

## 生命周期交付（历史检查点）

本仓 `add-managed-skill-lifecycle` **26/26** 指定任务已实现验收。官方Pi/pi-ai基线0.99.2，类型检查、160项fake/SDK回归及OpenSpec strict通过；[原生隔离操作链](delivery-evidence.md)另验索引→启用→暂停→禁用/reload→卸载后标准skill仍可发现，并核对列明的旧个人路径未被访问。

**7.1通过的是任务允许的协议替身合同，不是当前memory仓的真实互操作。**现有两仓R2/R5及账本不同，memory运行时没有完成本协议接入。skill可单独运行；实现验收时未同步两仓收费政策、未修改memory、未个人安装/发布，未新增真实收费请求。见[可选协作及限制](review-cooperation.md)。

## 证据入口

- [主规格](../openspec/specs/)：4项能力、33条要求；其中28条来自生命周期交付，5条由自主笔记变更新增。
- [已归档proposal](../openspec/changes/archive/2026-10-05-add-managed-skill-lifecycle/proposal.md)、[design](../openspec/changes/archive/2026-10-05-add-managed-skill-lifecycle/design.md)、[tasks](../openspec/changes/archive/2026-10-05-add-managed-skill-lifecycle/tasks.md)
- [来源事实与决定](planning-evidence.md)、[本仓费用契约](review-contract.md)
- [实现和测试索引](implementation-evidence.md)、[使用与恢复](usage.md)
- [语义合并](curation.md)、[成员维护与恢复](maintenance-evidence.md)、[费用矩阵](fee-matrix.md)
- [历史SWE-2观察](swe2-validation.md)、[历史原生失败UI](tui-validation.md)、[手装审批证据](installed-approval-evidence.md)
- [具名范围及实际关系映射](traceability-map.json)、[逐关系语义审阅记录](traceability-review.json)

## OMD范围与责任

权威metadata是本仓 `.omd/`。此次把原14/26检查点继续更新到 **77文件、127具名范围、180条关系**；新增实际activity/content/permissions/archive/restore/curation/cooperation等模块、测试、原生fixture和使用证据的关系。28个需求仍通过设计、任务和实现/验证范围追溯；不声称覆盖每个源字符或由metadata证明业务质量。

先按当前标题或模块范围续改44个dirty/locate范围，保留链身份，再登记32个新范围和明确的新关系。普通范围续改不是Adapt。之后独立列出94条实际传播责任，固定plan SHA与各自change IDs，逐条核对上游变化、下游响应和证据，才执行94次精确Adapt。

审阅不是用“测试全绿”批量代替理解。例如，D5/D7等只是位置变化，记录了下游契约未改变；UI→旧TUI证据与review→旧SWE-2证据揭示过时措辞，已改为历史检查点并说明新功能未作真实模型重测。既有重复关系保留其各自ID，没有为了变绿删除责任。

每次metadata写入前重新verify并使用fresh expected，源码hash冻结；没有重建store、清锁或跨store注册。中途expected JSON超过OS单参数长度，命令未启动；按已成功的131条receipt恢复，改用CLI支持的expected文件继续，没有重复重建链或绕过版本冲突。

范围/语义审阅的详细回执保留在 `/var/tmp/hermes-delivery-PfAReH/omd/`；永久派生入口是本页的map和review文件，`.omd/`才是历史权威。最终verify/check/links结果写入map的implementationSummary；不再沿用旧139条healthy结果。此后编辑受管内容必须重新核对，而不能继续引用本检查点的绿色状态。

## 生命周期归档（历史检查点）

2026-10-05 经用户确认，先同步4份主规格，再归档此change；Purpose、28条要求及全部场景与delta保持一致。OMD保留原归档文件的链身份和实现证据，只更新移动路径及设计文档中的相对链接，不借归档新增业务实现或扩建追溯图。

## 核验命令

```sh
npm run check
npm test
openspec validate --specs --strict
omd verify --json
omd check --json
omd links --json
```

统计、源码定位、原生自动化、fake闭环和历史实模观察各有边界；真实账单、长期模型效果、真人日常体验及当前memory运行时兼容仍未证明。归档与GitHub提交/推送属于实现验收之后的独立授权；没有个人安装、npm发布或新增真实收费调用。
