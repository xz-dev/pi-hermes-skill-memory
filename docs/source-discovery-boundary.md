# CLI 与 SDK 来源接入（任务 3.1）

## 用户决定与接入

用户已在理解 SDK 嵌入应用含义后，选择 **嵌入应用也完整支持**，并确认薄的公开来源回调方案。对应 proposal、design D2、skill-discovery spec 和任务3.1已同步，不修改 Pi core，不依赖 fork/private API。

官方 CLI 默认入口用公开 `parseArgs`、`SettingsManager`、`DefaultPackageManager` 和 skill 载入 helper 重建配置允许的来源。`resolve(skip)` 不安装缺包；CLI `-e` 的临时包使用离线子进程解析，因为官方 `resolveExtensionSources` 没有 missing 回调且可能更新未固定 Git 来源。子进程只运行公开只读资源解析，`PI_OFFLINE=1` 仅作用于子进程，不调用模型、不加载扩展脚本、不改变主 Pi 环境。

SDK 使用 `createSkillsExtension({ agentDir, skillSources })`。对标准 `DefaultResourceLoader`，可复用 `createSkillSources`，须传入与宿主一致的 settingsManager、noSkills、additionalSkillPaths 和 additionalExtensionPaths。自定义 loader/skillsOverride 应直接提供**已完成所有宿主过滤、但尚未按 name 去重**的最终 Skill[]，而不是再扫描被排除的目录。

```ts
const skillSources = async ({ cwd, projectTrusted }) => ({
  version: 1,
  cwd,
  projectTrusted,
  skills: finalAllowedBeforeNameDedup,
  diagnostics: exclusionDiagnostics,
});
const extension = createSkillsExtension({ agentDir, skillSources });
```

版本、cwd 或信任状态不匹配，回调错误和未接入 SDK 都报告 source-error/unsupported，清空旧索引；不通过旧快照或未知目录扫描补回。回调属于宿主接入代码，不是 skill 正文、项目配置或模型提案的权限入口。最终集合为空时不合并配置来源。scope 与 owner 独立，只有匹配的 manifest 身份和 saved 创建记录可成为 managed；目录名或 managed 标识本身不授权写入。版本是当前正文 SHA-256。

## 官方边界复现

`test/resource-boundary.test.ts` 在独立进程使用临时 HOME、agentDir、项目及 in-memory settings。结果：

| 入口 | 结果 |
| --- | --- |
| DefaultPackageManager.resolve(skip)，配置及信任允许 | 两个 enabled 同名来源 |
| DefaultResourceLoader 正常加载 | 一个 skill，另有 collision diagnostic |
| noSkills=true | 零个 skill |
| 单独运行配置来源解析器 | 仍有两个 enabled 来源 |
| SettingsManager.getSettings() | 没有 noSkills 运行时选项 |

初次复现曾因未隔离 HOME 自动发现私人 `~/.agents/skills`，来源数91而非2；修正为临时 HOME 子进程后重新通过，未把私人正文送给模型。这个 setup 失误不作为机制反证。

## 回退失败的根因与验证

先搜索优先、再让回调失败的最初测试断言“第二次 provider 上下文含原生 skill 名”，但 fixture 禁用了 read/bash 两种原生读取工具。官方 system-prompt builder **只有这些工具之一被选中时才呈现原生目录**。`normalizeBuildSystemPromptOptions` 每次复制基础 skill 集合：第二轮进入 hook 时仍有一个 native skill，搜索改写没有持久删除它。不能通过缓存旧目录修这个测试。

修正 fixture 为保留 read，同时保留替代搜索/读取工具后，验收包括：搜索优先 → 回调失败恢复原生目录 → 旧索引空且诊断可见 → `/skill:release-check` 实际展开正文 → 回调恢复后当前提示词返回搜索优先。旧聊天中的已读内容不被伪称从历史消除。

## 执行入口与边界

- `test/sources.test.ts`：同名独立稳定标识、项目优先、owner/provenance、read-only、版本、explicit-only、SDK 过滤/空集、协议/旧项目/信任冲突、刷新失败及回退往返。
- `test/stock-sources.test.ts`：临时 HOME，配置排除、noSkills、未信任项目、缺包不安装、临时包 manifest 过滤。
- `test/cli-sources.test.ts`：实际官方0.99.2 CLI 默认扩展入口，fake 前台 Agent 调用 registered search，断言两个同名来源及 `--no-skills` 空集；零真实模型调用。

来源基线：[skills.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/skills.ts)、[resource-loader.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/resource-loader.ts)、[package-manager.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/package-manager.ts)、[system-prompt.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/system-prompt.ts)、[extensions/runner.ts](https://github.com/badlogic/pi-mono/blob/a4715ec9bffbfcb8a32a1a4100dcfd06c12c93e4/packages/coding-agent/src/core/extensions/runner.ts)。实际运行证据针对锁定 npm 包；源码定位、OMD 关系不替代测试。

本切片不代表完整搜索分页、引用安全、原生显式模式控制、手装写入授权或自动学习调度已完成。
