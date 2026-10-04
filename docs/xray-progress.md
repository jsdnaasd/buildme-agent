# BuildMe 重构进度

更新：2026-10-05。需求基准：[PRD v1.0](./prd-xray-capabilities-compare.md)。

## 当前状态

**M0 地基的指定自动化验收已完成。M1 尚未开始。** 本轮停在 M0，不同时展开界面、能力开关、成就或双引擎对比。

## 第二轮交付

| 功能 | 实际行为与文件 |
|---|---|
| 子 Agent 执行树 | `pi-agent-runtime.ts`、`tool-registry.ts`、`trace.ts`：父回合记录 `subagent.start/end`，通过 `childTurnId` 查询完整子回合；子回合保存 `parentTurnId/parentToolCallId`，并行任务不会串线 |
| 共用执行链 | `full-edition-tools.ts`：沿用已有 `ctx.agents.run()`；委派和工作流共用子任务调用配置，不复制运行时。子任务继承连接、工作区、权限和 raw 开关，保留 standard 工具集 |
| 取消传播 | `agent-registry.ts`、`pi-agent-runtime.ts`：父任务的取消信号传给正在执行的子任务；顺序工作流取消后不启动下一步 |
| Skill 事件 | `full-edition-tools.ts`：目录记录名称/简介，成功加载记录真实路径、字符数和来源标记；加载失败不伪造成功事件 |
| 工作流事件 | 每一步记录 start/end/error；`stepIndex` 从 1 开始，`toolCallId` 区分并行工作流；失败后保持原来的停止语义 |
| 上下文裁剪 | `context-compaction.ts`：普通裁剪及最后兜底裁剪均记录 `context.clipped`，包括关联工具、裁剪前后字符数；没有实际变化则不生成事件 |
| 观察故障隔离 | 新事件仍走同一脱敏和异常隔离边界；裁剪观察器抛错不改变模型实际收到的上下文 |
| 真实桌面验收 | `scripts/verify-xray-electron.mjs`：在临时数据目录启动生产桌面主进程、renderer 和 preload；执行假模型回合、退出、重启，再从真实 IPC 回读 |

**更正第一轮文档错误**：子 Agent 原本就通过 `ctx.agents.run()` 进入同一个运行时，并非另行直接创建 Pi Agent。第一轮实际缺的是父子关联及参数传递；本轮据源码修正实现和文档。

父回合 usage 仅统计自身模型调用，子回合单独统计，避免重复计数。将来显示整个任务树消耗时，需要明确汇总后代回合。当前 Skill 只来自工作区/用户目录，所以 `builtin = false`；这不代表可以证明作者身份。

## 第一轮已交付的基础

- `trace.ts`：统一回合、事件、保真度、上下文结构和统计累加。
- `trace-collector.ts`、`pi-agent-runtime.ts`：模型请求/响应、usage、工具、审批、压缩、成功/错误/取消。
- `prompt-registry.ts`：动态提示词只求值一次，实际执行和 Trace 使用同一份快照。
- `redact.ts`、`trace-redact.ts`：复用已知密钥替换，添加敏感字段、环境值和 key 模式脱敏；先脱敏后广播/落盘。
- `trace-store.ts`：每回合一行 JSONL、活动回合内存查询、历史恢复、同回合去重、写入排队。
- 容量：每回合 raw 合计 2 MiB；工具预览 4 KiB、完整记录 64 KiB；只保留最近 20 回合的 raw；全目录上限 500 MiB，按会话文件最近写入时间清理。
- `desktop/main.mjs`、两份 preload：`xrayTurns`、`xrayTurn`、`onXray`；设置中的 raw 开关默认开启，下一回合生效。

当前可见界面变化仍只有原始请求记录开关。X 光抽屉、回答统计条属于 M1。

## M0 验收证据

| PRD 条目 | 证据 |
|---|---|
| A-1 | Pi 真工具循环配对请求/响应/工具/审批；真实桌面假模型回合执行 66 个工具，共生成 202 个事件 |
| A-2 | 动态 section 只求值一次，记录拼接等于发给模型的 systemPrompt；涉及敏感值的显示仍须脱敏 |
| A-3 | 运行时测试验证请求事件早于文本 delta；真实 preload/IPC 收到实时事件 |
| A-4 | 小上下文触发压缩并记录 tokensBefore；另有 4 项裁剪测试覆盖普通/兜底裁剪、无变化和观察器故障 |
| A-5 | 并行子任务各有独立 Trace，通过父事件 childTurnId 从新 Store 恢复；失败、取消、并行工作流和 raw 继承均覆盖 |
| A-7 | 主/子回合的文件和通知扫描假密钥；真实 Electron 收到的通知中也不包含假密钥 |
| A-8 | 采集器公开方法逐一注入异常；新增能力事件和裁剪观察器故障均不改变 Agent 正常结果 |
| A-9 | 真实 Electron 重启后，通过 preload → IPC 冷查询 202 个事件，实测 **46.1ms**（门槛 100ms）；仅代表本机本次测试 |
| A-10 | 两个独立 Electron 进程使用同一临时应用目录：第一进程写入，退出后第二进程恢复回合和摘要 |
| A-6 | 属于 M4；DSH 采集及保真度调研尚未实现 |

## 第二轮检查结果

- `pnpm test`：14 个测试文件、**130 项全部通过**。第一轮结束时 117 项，本轮新增 13 项（能力事件 9 项、裁剪 4 项）。
- `pnpm typecheck`：通过。
- `pnpm test:typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。
- `node scripts/verify-xray-electron.mjs`：通过；write 阶段 202 事件、实时 IPC、脱敏；restart 阶段恢复成功、查询 46.1ms。
- 所有模型响应均为 faux provider，没有调用真实模型 API。

可复现 Electron 验收：先运行 `pnpm build`，再运行 `node scripts/verify-xray-electron.mjs`。脚本隔离 userData/appData，完成后清理自己创建的临时数据。

## 下一轮：M1 X 光界面

先做回答下方统计条和可实时更新的 X 光抽屉，再接时间线中的工具、子任务树、Skill、工作流和压缩/裁剪事件。随后完成提示词、上下文、原始请求页、静态讲解、浅深主题和键盘操作。可以继续分批交付，不需要一轮完成所有 M1 功能。

后续顺序保持 PRD：M2 能力开关 → M3 成就 → M4 DSH/隔离工作区双引擎对比 → M5 讲解与模型对比。

## 已知边界与交接

- raw 标注 `format: "pi-context"`，是模型适配器输入，不冒充最终 HTTP 报文。
- 模型解析等运行准备阶段的失败尚未生成 Trace；审批超时与用户主动拒绝的进一步区分、海量历史索引和损坏文件局部恢复仍是后续改进项，不在本轮新增范围。
- CLI 可订阅 `piharness/trace`，当前只有桌面连接持久存储。
- 未验证真实模型 API、Windows、界面视觉体验及“Trace 额外开销不超过 5%”。真实 Electron 冒烟测试不代替这些验收。
- 仓库原有通用 Agent 提示词迁移、DSH 启动调整等未提交改动保留，不归为本轮成果。里程碑提交只收录两轮 M0 实现和相关文档/验证脚本。
- 没有删除 DeepSeek 依赖，没有替换 Cordis/Loader/Include/Profile/Bundle，没有改动 `release/`，没有新增依赖，没有发布或推送。
