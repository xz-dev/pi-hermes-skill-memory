# 显式语义合并（6.2）

先 `/hermes-skills curate list` 查看确定性候选，再选择两个当前允许、未pin、可写、同scope/项目的受管技能。候选、名称相似或相同正文都不是删除/吸收许可。

```text
/hermes-skills curate propose <keep-id> <absorb-id>
/hermes-review status
/hermes-review usage
/hermes-skills pending
/hermes-skills curate apply <pending-id>
```

`propose` 是**一个计量请求**，复用单请求review入口、完整有效上下文、当前模型、取消、64k输入/4096输出/90秒和UTC日预算。输入额外包括两者全部有创建依据的成员与版本、已知引用影响；不裁剪为只看正文。超预算跳过；无变更、无效输出、错误和取消都不补发请求。没有自动语义整理定时器。

模型最多返回一个保留技能的update。该请求只形成有界pending，不能直接归档或修改任一技能。`apply`（亦可`approve`）在实际TUI显示保留技能before/after和被吸收成员的完整差异，明确内容批准不等于事实认证。RPC或全局手装修改授权不能绕过此内容批准。提交前及writer内复核原版本、作用域、来源和保护政策。

## 部分提交与恢复

合并顺序是保存keep，再逐成员归档absorb，**不是跨文件原子事务**。

- 若尚未写入，失败保留pending及原因，可处理版本冲突或明确reject。
- 若已开始提交，applying记录保留，状态区跨reload提示未决；不得通过reject伪称全部回滚，新收费请求被阻止。
- 如 `/hermes-review recovery` 列出未完成的keep事务，先用 `recover <key> commit` 完成本地成员恢复；已提交成员不能假abort，手改仍冲突。
- 再次 `curate apply <pending-id>` 只续剩余本地操作，不重放模型，不重复保存已完成的keep版本。
- 完成结果给出 `history <keep-id>` 与 `restore <archive-id>`。原始被吸收正文、资产、来源与恢复索引保留在非扫描根；restore仍须当前宿主允许，不覆盖人工新文件。

合并不改写未知外部引用，不执行脚本，不安装依赖，不改变原review的计量终态。已知引用影响会展示；未检查的外部使用方明确标为unchecked。

## 证据与边界

`test/curation.test.ts` 12项注册SDK检查覆盖正例、恢复原资产、保护/跨scope拒绝、stale内容、RPC与全局grant边界、实际keep及archive成员中断/reload/本地恢复、无变更、非法目标、预算跳过、取消及迟到仅计量。当前typecheck0/full135/135/strict0，日志 `/var/tmp/hermes-curate-{check,focused,full,validate}.log`。

全部为隔离fake provider。证明流程、权限和次数，不证明真实合并质量或真实账单。原生diff界面的验证见[维护证据](maintenance-evidence.md)。联合费用协议和最终交付尚未完成，不建议安装到个人环境。
