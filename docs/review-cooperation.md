# 可选审查协作（7.1）

两个插件独立安装和运行。skill 不导入、不安装、不调用 memory 仓的运行时，也不要求存在 memory 服务。单装时沿用同一个 review、ledger、store 和 UI 路径；仅请求 skill 提案。

## 收费与权限边界

- 本仓保持 `review-contract.md` 现有 R2/R5：未知预留持续保留，未采用 memory 仓的“确认当日记一次”变更。用户强调独立使用不是费用规则变更许可。
- 双方都到期且声明相同协议、费用策略、预算位置和快照身份时，共用一次完整上下文请求。UTF-8保守输入估算包含 memory 声明的目标/证据；超过预算整次跳过，不裁剪或分开付费。
- 每个插件独立决定目标是否到期及是否获用户启用；另一方的声明不授予写权限或开启其自动学习。已声明inactive的目标不参与，也不要求它采用相同的收费策略或预算位置。
- 兼容性失败会在本插件持久账本中暂停并显示原因，免费读取仍可用。不尝试独立收费、安装依赖或升级另一插件。
- 这不是对任意第三方扩展的沙箱，不能阻止一个不遵守协议的插件自行联网。已知 `hermes_memory` 工具存在但未声明协议时，本插件拒绝发请求；未知第三方收费行为不在控制范围内。

## 小型事件协议

通道 `hermes.review.v1`，请求为 `{type:"collect", version:1, boundary, offers, retryOf?}`。声明在同步emit期间完成。实现及公开TypeScript形状见 `src/cooperation.ts`。

`boundary` 包含session/cwd/leaf/有效快照digest/provider/model。它与附加整理证据后的分析digest分开记录。同进程重叠任务临时合流；真正的防重复、跨进程预留和日额度由磁盘ledger锁控制，不依赖RAM历史。

每个目标声明 `target`（skills或memory）、version、compatibility、ledgerRoot、boundary、active和run。固定标识降序决定owner：共同参与时为skills，memory-only由其自身运行时负责。本仓不是memory运行时的实现。迟到目标须查已有boundary记录并等下一合格边界，不能为缺失目标另发请求。

当前费用/账本兼容标识：`hermes-review-ledger/1;unknown-reservation-carry/1;single-request/1`。只使用同一个事件名不表示账本结构、unknown语义或费用策略兼容。双方各自保存自身文件和恢复日志，没有跨目标原子事务。

memory目标另外提供instruction、AbortSignal、current检查和consume回调。请求同时输出JSON的skills/memory字段；skill验证并提交skills，memory消费者只接收memory字段及同一requestId，并自行验证、遵守当前性/取消guard后提交。不能把模型结果当作权限。任一参与者过期/取消撤销未完成的提交资格；已经提交的成员不会被伪称回滚。受控writer退出后记录终态，不承诺强停任意第三方I/O。

总账记录targets、reviewOwner、boundary、实际saved成员与统一usage；TUI显示目标集合。某消费者失败不补发模型，也不会假装之前已成功的另一目标未写入。

## 验收

`test/cooperation.test.ts` **15项**真实注册SDK入口检查：独立skill、兼容共同提交、inactive解耦、同时到期/并发/迟到/reload去重、单次no-change与消费者失败、用户取消/peer取消/peer过期、合并输入预算，以及fee/root/identity/version/无协议冲突跨reload可见。检查实际目标文件与磁盘账本，不只检查回调数。

`test/ledger.test.ts`另有两个进程以不同目标digest竞争同一boundary：只有一个准入、一个模拟发送记录；reload后的迟到目标仍拒绝。

当前typecheck0/full**151/151**/strict0：`/var/tmp/hermes-joint-{check,full,validate}.log`。全部隔离fake，无真实收费测试。

**实际memory仓不在本验收范围内修改。**只读核验发现其当前R2/R5、账本格式与本仓不同，且未发现协议参与注册；不能声称当前两仓可直接联合自动学习。本页证明的是任务7.1允许的协议替身合同，不是该memory运行时的真实兼容性。未来兼容须在双方各自授权范围内复核，不要求单装用户先做跨仓同步。
