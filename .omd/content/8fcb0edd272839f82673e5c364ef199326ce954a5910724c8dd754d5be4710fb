# 6.3 维护与恢复验收

## 验证范围

官方 Pi / pi-ai **0.99.2**。当前检查点：`npm run check` exit 0、`npm test` **125/125**、`openspec validate add-managed-skill-lifecycle --strict` exit 0。日志为 `/var/tmp/hermes-maintenance-{check,full,validate}.log`。这是6.3完成证据，不替代6.2语义合并、7.1联合计费、7.2费用矩阵或7.3最终交付。

| 指定行为 | 验证 |
| --- | --- |
| 逐成员归档、退出默认搜索、保留来源与恢复索引 | `test/archive.test.ts`；受管仅创建记录成员，手装明确清单，共享引用只备份，邻居不动 |
| 恢复原字节、ID、scope、owner，且须当前来源允许 | `test/restore-sources.test.ts`；配置路径、显式CLI路径、配置包、临时本地包、缓存npm、缓存Git六条注册命令往返 |
| 当前排除/noSkills、配置撤回、链接改指向、版本及包覆盖顺序 | 40项官方loader差分；缓存npm与五种Git写法的官方root对照；判定期间目标缺席，无恢复探测写入 |
| 回滚保留精确旧正文/frontmatter/资产，新成员撤出但保留物理备份 | `test/rollback.test.ts`；再次反向回滚仍可恢复成员；创建回滚走可恢复archive |
| 手改、pin、来源撤回、共享引用冲突 | `test/archive.test.ts`、`test/rollback.test.ts`；不覆盖人工版本，不新增付费修复 |
| 已知引用影响 | 检查允许的primary、受管成员及当前read引用；不改写引用，明确外部引用未检查，不把后台自读计为使用 |
| 中断后真实状态与当前恢复授权 | 逐成员prepared/content-committed；拒绝已提交后的假abort；授权撤销后剩余成员不写，恢复不重放模型，错误跨reload可见 |

## 原生 CLI/TUI 路径

使用隔离 `/var/tmp/hermes-maintenance-tui-uBMt1x`，`env -i`、临时HOME/agentDir、`PI_OFFLINE=1`、官方 `dist/bundle/cli.js`。分别显式加载生产 `src/index.ts` 与 `test/fixtures/tui-maintenance.ts`；后者只建立测试历史、提供禁止模型调用的fake provider，不替代生产来源或恢复策略。非Git项目根在原生输入框中明确选择。

实际操作及capture：

- `rollback-preview*.txt`、`rollback-confirm.txt`：完整before/after、被撤出成员、scope、版本、owner与diff hash。
- `rollback-denied.txt`：No保留更新后的hash `594a41ed4e357381bc78e53162955be46f076535d9933250b32505df08e7fbbb`。
- `rollback-accepted.txt`：Yes恢复原始字节，introduced member从活动目录消失，历史备份仍由自动化回归验证。
- `archive-preview.txt`、`archive-confirm.txt`、`archive-accepted.txt`：生产命令归档A.md，共享reference与邻居保留。
- `restore-excluded*.txt`：加入当前项目排除后，即使用户确认diff仍拒绝恢复；原路径保持缺席。
- `reload-conflict.txt`：未解决失败在实际 `/reload` 后仍显示 `Hermes maintenance: 1 unresolved`。
- `restore-allowed*.txt`、`restored-inspect.txt`、`verified.json`：移除排除后经新diff确认恢复精确字节与原ID，owner仍为user-owned。没有模型调用，辅助ledger为零条；测试终端已退出。

这是原生终端自动化，不是真人日常体验、真实模型学习质量或账单证明。

## 发现并修复的实际缺陷

1. 手装回滚中断后，旧intent曾能在全局授权已撤销时续写。现在本地recovery要求当前全局grant或重新确认精确TUI diff；确认在writer锁前，锁内重建比对，每个成员在来源检查前后复核授权与保护状态，取消撤销writer资格。RPC不能冒充TUI，原批准记录本身不能替代当前许可。
2. 官方TUI editor提交会trim外层空白，恢复内容末尾换行曾使未编辑的预览被误判为编辑。预览现在以固定末尾标记包住所有文件字节，仍执行精确文本相等判断；没有放宽成trim后相等。SDK archive UI测试模拟真实trim行为，原生恢复也重新通过。

## 兼容与操作边界

- CLI缺失路径判定采用用户选定的本地只读规则路线；使用公开设置/CLI参数和已核验规则，不调用私有SDK运行时API、不安装缺包、不先恢复试探许可。
- 缓存型临时npm/Git定位针对已验证的**0.99.2布局**。未验证的SDK缓存布局返回unsupported，不声称适配所有未来版本；SDK可提供自己的当前 `restorePolicy`。未接回调只阻恢复，不影响普通读取。
- 受管与手装恢复都不得覆盖当前文件。先检查 `archives` / `history` / `recovery`，人工处理冲突后重新执行；无强制覆盖、永久purge或未知费用清零。
- 手装无UI的archive/restore/rollback进入bounded pending；`approve`须原生TUI。中断store事务使用 `/hermes-review recover <key> commit|abort`；无当前grant的installed commit须TUI重新核对剩余差异。
