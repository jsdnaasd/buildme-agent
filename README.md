# BuildMe / PiHarness

个人 Agent 桌面与 CLI：**Pi Agent Core 是唯一 Agent driver，DeepSeek Harness（DSH）的 Cordis/Loader/Include/Profile/Bundle 架构负责组合。**

当前版本已经从早期的“DSH-inspired 自制宿主”迁移为一套可运行的 **DSH 架构精简移植**：使用 DSH 官方发布的 scoped Cordis 包、真实 Loader Entry ABI、Include 导出的 patch 算法、bundle/profile/overlay 分层，以及 `ctx.agents.setFactory()` 形式的可替换 AgentFactory。上游架构与启动语义的核对基线固定为 `deepseek-ai/deepseek-harness@0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`。

## 两个版本

BuildMe 是面向学生论文写作的学术助手，桌面端有两种模式，界面相同，顶部按钮切换：

| | **Build 模式（轻量）** | **全量版（DSH 引擎）** |
|---|---|---|
| Agent 执行 | Pi Agent Core + BuildMe 自己的 Cordis 插件 | DeepSeek Harness 原生 agent loop（`dsh-base`） |
| 文档 | `document_read`：PDF 按页、Word、HTML | 同一个 `document_read`，以 DSH 工具形式挂载 |
| 联网 | 可读网页正文（`web_fetch`） | `web_search` + `web_fetch` |
| 子 Agent / 工作流 | `delegate_task` / `workflow_run` | `subagent`、`subagent_fork`、`workflow`、`ralph` |
| 定时任务 | — | `schedule_create` / `list` / `delete`；到期在同一会话继续并弹系统通知 |
| 命令 | Pi `bash`，按权限模式审批 | 沙箱 bash，越权时向 BuildMe 界面申请审批 |
| 其他 | 技能、计划、待办、上下文压缩 | 技能、待办、长期目标、后台任务、上下文压缩 |
| 模型 | Pi 目录全部 provider 与中转站 | DeepSeek 原生适配器；其他 provider 与中转站走 `dsh-llm-pi-ai` |

两种模式共用同一份学术提示词（`bundles/base/prompts/buildme-academic.md`），全量版把其中的工具说明替换为 `buildme-tools-dsh.md`。

### 全量版如何工作

```text
BuildMe 界面（renderer） ⇄ IPC ⇄ Electron 主进程 desktop/main.mjs
                                     │ desktop/dsh-engine.mjs
                                     │ 以官方 dsh 启动器拉起子进程：
                                     │ dsh --profile buildme --patch <BuildMe overlay>
                                     ▼
            DSH 进程（@deepseek-ai/dsh-base 全部核心能力）
              + dsh-schedule / dsh-time-context
              + dist/full/dsh-document-tool.js（document_read）
              + dist/full/dsh-bridge.js（stdio JSON-RPC 桥）
```

- 桥接插件提供 `session/run`、`session/cancel`、`session/list`、`session/messages`、`tools/list`、`schedule/resume-pending`，并把流式文本、工具调用、会话状态推给主进程；DSH 的每个审批请求都通过 `approval/request` 交给 BuildMe 弹窗决定。
- 全量版使用 BuildMe 自己的 `DSH_HOME`（应用数据目录下的 `dsh/`），不读写 `~/.dsh`；遥测默认关闭。
- 密钥只通过子进程环境变量传入（`BUILDME_ACTIVE_API_KEY` / `DEEPSEEK_API_KEY`），不写入任何配置文件。
- 权限映射：`ask` → DSH `read-only`，`workspace-write` → `workspace-write`，`bypass` → `danger-full-access`。
- 定时提醒只在会话在线时触发：全量版随应用启动，并自动恢复有待办提醒的会话，逾期提醒立即补发。macOS 关闭窗口后应用仍在后台运行，提醒照常触发；完全退出 BuildMe 后，提醒会在下次启动时补发。
- `web_search` 使用 DeepSeek 搜索接口，需要 DeepSeek Key；使用其他模型时如未配置 DeepSeek Key，网页搜索不可用，`web_fetch` 不受影响。

## 现在与 DSH 对齐的部分

- `@deepseek-ai/cordis@4.0.2`
- `@deepseek-ai/cordis-plugin-loader@1.0.3`
- `@deepseek-ai/cordis-plugin-include@1.0.7`
- `@deepseek-ai/cordis-plugin-group@1.0.2`
- `node-addon-require-builtin@0.1.6`（Loader 的 Node internal-module bridge）
- Loader row ABI：`id / name / config / group / disabled / inject / intercept / isolate`
- Profile 端从空数组依次应用 base bundle、profile patch、home patch、CLI overlay
- 直接调用 Include 导出的原生按 ID patch 算法；`config` 是整字段替换，不做深合并
- 随包只读根 Include 只挂载空配置载体；兼容适配层把已经合成的行逐条交给 Loader 生命周期
- 依赖由 Cordis `inject` 与 service availability 驱动；配置行顺序没有启动语义
- DSH 核心服务缝：`ctx.sessions`、`ctx.systemPrompt`、`ctx.tools`、`ctx.llm`、`ctx.agents`、`ctx.agentLoop`
- `ctx.agents` 持有稳定 AgentRegistry；Pi loop 只以 AgentFactory 插件身份注册
- Loader Fiber 的 pending/active/failed 审计：DSH 全局 startup-critical ID fail-loud，其余 inactive row 发 warning 并保留已激活兄弟
- 许可证归属随源码与 Desktop 包发布，UI 不使用上游 Logo 或品牌素材

这些版本号与固定 commit 的 `vendor/*/package.json` 一致，但 npm registry 中的同版本 Cordis/Loader/Include tarball 与该 commit 的工作树源码并非逐文件相同，尤其 Loader 的初次多行挂载和 settled Fiber rejection 行为不同。本项目明确保留官方 npm runtime，并用小型的逐行挂载与结算审计适配层复现固定 commit 的 startup-critical/optional 边界；这里不宣称运行期 tarball 是该 commit 的逐字构建产物。

## 组合图

```text
profile/package.json: dsh.profile.bundles
                + profile/cordis.patch.yml
                + $PIHARNESS_HOME/cordis.patch.yml
                + --patch overlay
                            ↓
       Include.applyEntryPatches(empty, profile layers)
                            ↓
       packaged empty root Include + per-row mount adapter
                            ↓
        @deepseek-ai/cordis-plugin-loader Entry tree
                            ↓
  ┌────────────── DSH-shaped service seams ──────────────┐
  │ sessions  systemPrompt  tools  llm  agents          │
  └──────────────────────────┬────────────────────────────┘
                             │ ctx.agents.setFactory(...)
                    agent-loop row → Pi Agent Core
                             │
                    JSONL facts + live events
```

`bundles/base/cordis.patch.yml` 是个人版 base bundle。它保留 required row ID `agent-loop`，但从源头把该行指向 `cordis:piharness-agent-loop-pi`，因此不会同时启动 DSH 默认 loop 与 Pi loop。

## Pi Agent 实际提供了什么

这里不是只借用了 Pi 的名字。当前执行链直接使用 `@earendil-works/pi-agent-core` / `pi-ai` 的：

- `Agent` 多轮状态机、流式事件、消息与 tool-result 协议；
- tool schema 参数校验、parallel/sequential 执行、`beforeToolCall` 授权闸门、abort 生命周期与 thinking level；
- Pi 原生 `read`、`write`、`edit`、`bash` 工具，通过 Cordis 工具插件接入所选工作区；
- `Models.streamSimple`、provider auth、请求级 API Key/Base URL 与 sessionId 透传；
- 当前安装版本随包的 **40 个 provider factory、1,354 个模型条目**，包括 OpenAI、Anthropic、Google/Vertex、Amazon Bedrock、DeepSeek、OpenRouter、xAI、Groq、Mistral、Moonshot、MiniMax、Qwen、Z.AI、NVIDIA、Together、Fireworks、Hugging Face 等；
- OpenAI Chat Completions / Responses 兼容 adapter，因此任意兼容中转站、本地服务和自定义模型 ID 都能作为连接加入。

DSH/Cordis 层负责另一半：profile/bundle/patch 组合、插件生命周期、`ctx.*` 服务缝、持久 session、prompt/tool/policy registry 与可替换 AgentFactory。也就是说，**Pi 负责 Agent 执行，DSH 架构负责 Everything is a Plugin 的装配**。

## 快速开始

要求：Node.js `>=22.19`、pnpm。

```bash
pnpm install
pnpm build
node dist/cli.js init
export DEEPSEEK_API_KEY='YOUR_KEY' # 也可使用其他 provider 自己的环境变量
node dist/cli.js plugins doctor
node dist/cli.js run "查看当前工作区，并告诉我有哪些顶层文件"
```

开发模式：`pnpm dev run "你的问题"`。

新 profile 采用 DSH 的目录形式：

```text
.piharness/
├── package.json          # dsh.profile.bundles
└── cordis.patch.yml      # 个人配置层
```

空 Include leaf 随应用发布在 `bundles/base/cordis.empty.yml`；启动和插件诊断不会在 profile 中生成或改写额外 carrier 文件。

以前的 `.piharness/profile.json` 仍会在读取时转换成相同 Loader tree，便于现有本地会话继续使用。

## Profile 与 patch

`package.json` 声明有序 bundle：

```json
{
  "name": "my-agent-profile",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@my-agent/base"],
      "patchReload": "startup"
    }
  }
}
```

`cordis.patch.yml` 通过稳定 row ID 改配置。和 DSH 一样，下面的 `config` 会整体替换 settings 配置，因此要写完整对象：

```yaml
- id: settings
  config:
    name: BuildMe
    home: .
    agent:
      provider: deepseek
      model: deepseek-v4-flash
      apiKeyEnv: DEEPSEEK_API_KEY
      thinkingLevel: off
      toolExecution: parallel
      # 默认预设会加载随 BuildMe 发布的 Claude Code Opus 5 提示词。
      # 这里填入任意字符串即可为本 Profile 覆盖该预设。
      systemPrompt: '@buildme/claude-code-opus-5'
```

临时覆盖：`node dist/cli.js plugins list --patch ./experiment.patch.yml`。

## Everything is a Plugin

默认 base 中每项能力都是 row：

- `settings` → `ctx.settings`
- `session` → `ctx.sessions`
- `system-prompt` → `ctx.systemPrompt`
- `tools` → `ctx.tools`
- `llm` → `ctx.llm`
- `agent` → `ctx.agents`
- `llm-pi-ai-builtins` → Pi AI 全量 provider/model catalog
- `persona` → prompt section
- `workspace-info` → tool
- `workspace-tools` → Pi 原生 read/write/edit/bash
- `permission-mode` → ask/workspace-write/bypass policy
- `agent-loop` → `ctx.agentLoop` + Pi AgentFactory

`llm-pi-ai-deepseek` 与 `allow-list` 仍是可单独插入的兼容插件，但不再是 base bundle 的默认行。

中转站也可作为普通 Cordis row 固化；密钥只引用环境变量，不写进 profile：

```yaml
- insert:
    - id: my-relay
      name: cordis:piharness-llm-openai-compatible
      config:
        id: my-relay
        name: 我的中转站
        baseUrl: https://relay.example.com/v1
        apiKeyEnv: MY_RELAY_API_KEY
        models:
          - id: vendor/model-name
```

开发试验可用 DSH patch 禁用原 row，再插入新 row；调用方仍只访问 `ctx.agents`：

```yaml
- id: agent-loop
  disabled: true
- insert:
    - id: my-agent-loop
      name: ./plugins/my-agent-loop.mjs
```

这里的 `my-agent-loop` 属于 optional row。用于稳定发行的 bundle stack 应在组合源头只产出一个 canonical `agent-loop` row，并直接让它指向选定的 AgentFactory；这样才能继续命中 DSH 的 startup-critical fail-loud 规则。本仓库的 `@my-agent/base` 正是这种做法。

外部插件由 profile 自己的 `dependencies` 管理，并以标准 Cordis default export 与 `plugin.inject` 声明服务依赖。参见 `docs/plugin-authoring.md` 与 `examples/`。

## Desktop（BuildMe）

```bash
pnpm desktop
```

打包：

```bash
pnpm desktop:package
open "release/BuildMe-darwin-arm64/BuildMe.app"

# Windows x64 便携版（解压后运行 BuildMe.exe）
pnpm desktop:package:win
```

Windows 交付文件位于 `release/BuildMe-<版本>-win32-x64.zip`，同目录的 `.sha256` 文件用于校验分发包完整性。

Desktop 采用双栏任务界面和底部 Composer，支持亮色/深色/跟随系统、原生文件夹工作区、Pi catalog 模型选择、多连接及中转站、会话、流式回答、取消和真实工具审批。权限有三档：`ask`（写入/命令询问）、`workspace-write`（工作区文件自动，命令仍询问）、`bypass`（完全不审批且不做工作区路径限制）。API Key 通过 Electron `safeStorage` 加密落盘，并按请求传给模型，不注入 shell 环境。名称、图标与界面只显示“BuildMe”。

侧边栏底部的“插件市场”只保留 Pi 社区第三方扩展，提供按 npm 月下载量聚合的热门榜、GitHub Star 排序的社区仓库入口和 r/PiCodingAgent 近期热门讨论。Pi 包源支持 `npm:`、`git:` 和 HTTPS 仓库链接。OpenAI Apps 目录已移除，因为它不是 BuildMe 当前 Pi/Cordis 运行时可直接导入的插件源。

Claude 连接在“模型与偏好”中选择 `Anthropic`：常规 `sk-ant-api…` API Key 与 Claude Code 的 `sk-ant-oat…` OAuth Token 都可直接填入；后者由 Pi 自动走 Bearer/OAuth 与 Claude Code 请求格式。OpenAI 格式中转站选择 `OpenAI 兼容 / 中转站`，填写服务商给出的完整 `/v1` Base URL、模型 ID 与 API Key；提供 Anthropic Messages 协议的中转站则选择 `Anthropic` 并覆盖 Base URL。

服务商目录用于选型，不限制手动输入新模型 ID：对已知 provider，手动模型仍保留该 provider 的原生请求协议，而不是降级成通用 OpenAI 格式。

## 与完整 DSH 发行版的边界

这里移植的是 DSH 的**组合架构、选定启动语义与核心替换缝**，并保留已经工作的 Pi/JSONL 纵向切片；它既不是完整 monorepo fork，也不是固定 commit 全部 vendored package 的逐字重建。完整上游还包含 canonical Session v3、session persistence/projection 分层、agent-scoped context、工具 waterfall、LLM middleware、HMR、插件安装事务、独立 Desktop host 子进程和完整 Web UI 插件图。具体映射与 npm artifact 边界见 `docs/dsh-upstream.md`。

## 验证

```bash
pnpm typecheck
pnpm test:typecheck
pnpm lint
pnpm test
pnpm build
pnpm desktop:package
```

## 许可与品牌

DeepSeek Harness 主体采用 MIT。复制和改造的架构/启动语义保留 `Copyright (c) 2026 DeepSeek` 与完整许可文本：

- `legal/DEEPSEEK_HARNESS_LICENSE`
- `THIRD_PARTY_NOTICES.md`

产品名为“BuildMe”，未使用 DeepSeek Harness 官方 Logo、名称或 UI 品牌插件。
