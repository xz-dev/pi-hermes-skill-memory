# 费用回归矩阵（7.2）

当前检查点：typecheck0、完整 **160/160**、OpenSpec strict0。日志 `/var/tmp/hermes-fees-{check,focused,full,validate}.log`。所有新测试使用隔离fake provider或本地模拟发送记录；不是实际账单/价格证明。

| 情形 | 实际断言 | 主要证据 |
|---|---|---|
| no-change | 1请求/1记录，128 fake tokens，不保存，reload后TUI仍显示 | fee-matrix |
| 空结果/仅reasoning | no-proposal，仍计量，不补发 | fee-matrix、review-limits |
| 无效JSON/不完整/tool/无证据 | failed，最多1请求，无自动纠正或工具执行 | review-limits |
| SDK provider抛断流 | 官方ModelRegistry转为error消息；无法透传的部分usage不伪造，完整预留保留、暂停跨reload可见 | fee-matrix |
| transport确实暴露部分usage | 保留原始`input:17`，规范化仍unknown | review-limits |
| usage缺失或全零 | unknown，不声称免费；输入/4096输出预留保留 | fee-matrix、review-limits |
| 价格未知 | usage可知但price UNKNOWN，TUI跨reload可见 | fee-matrix |
| 用户取消/对端取消/过期 | 原request终态不复活；迟到usage只更新原记录，两个目标不写 | fee-matrix、cooperation、lifecycle |
| 超预算/联合证据超限 | 0请求，skipped-budget，不裁剪、不拆请求 | review-limits、cooperation |
| 迟到usage超预留 | 即使用户此前resume也重新暂停，原终态/原因保留、无第二笔账 | ledger |
| enable后disable，再压缩/退出钩子 | 0辅助请求，auto=false、账本空 | fee-matrix；这里只发公开生命周期事件，不运行Pi本身的模型压缩 |
| 发出后杀进程 | 子进程留下1条模拟发送回执后SIGKILL；重开为failed/usage-unknown，300/4096预留保留，TUI暂停、run不重放 | fee-matrix |
| 并发进程/晚到目标 | 原子准入只能有1笔；不同分析digest但同boundary也不能补发 | ledger |
| 不兼容协议/预算身份 | 0请求，两侧目标不写，本插件持久暂停 | cooperation |
| 账本损坏/初始化后丢失 | 拒绝计费，不清零、不重建费用历史 | ledger |

矩阵发现并修正一个现有R2要求的遗漏：已取消且unknown的记录，在用户resume后收到超预留的迟到usage，旧代码只更新用量而未重新暂停。新增用例先red；修复仅增加超额暂停，不采用memory仓的新“确认当日扣一次”政策、不释放未知预留、不自动退款、不放宽费用许可。

原生终端的持久失败和确认观察见[tui-validation.md](tui-validation.md)；这里新增的是官方SDK绑定TUI回调的注册入口矩阵，不能冒充真人体验或新一轮原生终端测试。
