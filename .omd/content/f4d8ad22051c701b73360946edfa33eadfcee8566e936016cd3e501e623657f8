# 最终隔离操作链（7.3）

官方 npm Pi **0.99.2** 原生CLI/TUI，生产 `src/index.ts` 与隔离的 `test/fixtures/tui-delivery.ts`。临时目录：`/var/tmp/hermes-delivery-PfAReH`。

`launch.sh`使用`env -i`、临时HOME/agentDir、`PI_OFFLINE=1`、`--offline --approve --no-session --no-context-files --no-extensions`。只显式加载上述两个入口。fixture仅为临时项目建立信任并注册一个禁止调用的fake provider；不是source/权限/预算的替代实现。

## 真实终端步骤

1. 启动：原生列出临时 `delivery-rule`，Hermes auto OFF、search模式、0请求；`/hermes-skills status`显示允许来源与自动化OFF。
2. `/hermes-review enable`：在非Git项目的原生输入框明确选择临时project根，之后auto ON、0请求。
3. `/hermes-review pause`：auto ON且PAUSED user-paused；计数仍为0。
4. `/hermes-review disable`：auto OFF，保留暂停原因。
5. `/reload`：OFF与user-paused持久保留，0请求。
6. 退出；不加载生产插件、仅加载禁止模型调用fixture，再启动同一官方CLI。原生skills仍列出delivery-rule，没有Hermes状态区；原SKILL.md字节不变。

捕获文件为 `startup.txt`、`current.txt`（状态与选根框）、`enabled.txt`、`paused.txt`、`disabled.txt`、`reloaded.txt`、`plugin-unloaded.txt`。前两次过早capture未作为动作成功证明，以随后实际画面和磁盘状态为准。

## 磁盘与访问检查

- 最终ledger：records=[]、autoEnabled=false、paused=user-paused；没有生成受管技能，没有未知费用被清除。
- provider调用即会写unexpected-model-call并抛错；两次CLI运行后该标记均不存在。
- strace跟踪两次CLI及子进程的文件系统调用，保存为 `file-access.log` 和 `file-access-native.log`。
- 日志中没有访问真实 `/home/xz/.pi`、`/home/xz/.agents`、`/home/xz/.hermes`、`/home/xz/.config/pi`；工作目录、HOME、agentDir都是新建的隔离根。仓库源码和依赖读取是预期行为。
- `verified.json`记录空账本、关闭状态、无provider调用标记、旧个人路径零命中和原始skill字节。终端均已退出。

此链证明原生控制、持久状态和标准资源的退出兼容；不是自动学习质量评测、真人日常体验或真实账单证明。实际提案保存/后续复用、取消和失败路径由160项fake/SDK回归以及既有原生审批/恢复证据补充。
