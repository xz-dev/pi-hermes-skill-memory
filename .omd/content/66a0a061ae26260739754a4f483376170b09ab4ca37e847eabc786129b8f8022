# 持久失败与费用 TUI 验收

## 环境与步骤

官方 npm `@earendil-works/pi-coding-agent` **0.99.2**，不是本机 fork。临时 HOME、agentDir、cache 与工作目录位于 `/var/tmp/hermes-ui-validation-fsvZRY/`；`env -i` 不继承真实 provider 凭据，禁用其他扩展/skills/自动压缩/重试，只加载本扩展与 `test/fixtures/tui-failure.ts`。没有安装到个人 Pi，也没有真实模型请求。

在真实 TUI 中依次：

1. `/inject-review-failure` 生成一笔假请求并注入断流、未知 usage。
2. 发送普通用户请求，fake provider 显示正常前台回答。
3. `/reload` 重建扩展。
4. 暂停状态下 `/hermes-review run`。
5. `/hermes-review resume`，查看包含旧请求、未知预留和提示的确认框，再明确选择 Yes。

## 实际观察

- 初始：auto OFF、idle、errors 0、jobs 0/4。
- 失败后、普通前台回答后、reload 后均显示：
  `Hermes auto OFF | PAUSED fixture-disconnect | errors 1`。
- 同时持续显示 `usage UNKNOWN reserved 500/4096 | price UNKNOWN`；不是单次 toast/debug 日志。
- 暂停状态 run 返回 `modelCalled:false`，账本始终只有原来 1 条记录；未发新请求。
- 恢复确认框明确指出：未知预留不会清零，自动调度尚未开启。
- 确认后 errors 0、pause 清除；原记录、unknown、500/4096 预留和费用 unknown 全部仍在，jobs 仍为 1/4。

## 证据

临时目录的 `startup.txt`、`failed.txt`、`foreground.txt`、`reloaded.txt`、`paused-run.txt`、`resume-dialog.txt`、`resumed.txt` 是真实 terminal capture；`agent/hermes-review/ledger.json` 是持久回执。临时目录并非永久唯一来源，本页记录可重复步骤和结果。

`test/ui.test.ts` 对非 TUI 的 status/usage/errors、需要明确 acknowledgment 的 resume、预留保留及失效 UI 不丢账作自动验证。结构化详情写 stderr，避免污染 JSON 模式 stdout。

这是任务2.4的历史失败/用量界面验收，不是完整自动学习或多插件最终验收。该检查点尚未接通自动调度；当前调度、费用矩阵和原生启用/暂停/禁用证据分别见 `implementation-evidence.md`、`fee-matrix.md`、`delivery-evidence.md`。本页不把旧截图当新功能的原生验收，真实provider的未知收费也不能凭fake fixture推断。
