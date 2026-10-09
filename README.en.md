<div align="center">

<img src="docs/site/cover.svg" alt="BuildMe — Build to understand. Understand to build." width="100%" />

**Turn AI's capabilities into your own.**

An open-source Agent workbench for real work and a clear view of what happens inside.

[简体中文](README.md) · **English**

[Explore BuildMe](https://jsdnaasd.github.io/buildme-agent/en.html) · [Quick start](#quick-start) · [Architecture](docs/architecture.md) · [Contribute](CONTRIBUTING.md)

![MIT](https://img.shields.io/badge/license-MIT-cc6945?style=flat-square)
![Electron](https://img.shields.io/badge/desktop-Electron-252925?style=flat-square)
![TypeScript](https://img.shields.io/badge/code-TypeScript-4879a0?style=flat-square)
![Two engines](https://img.shields.io/badge/engines-Pi_%2B_DSH-252925?style=flat-square)

</div>

---

## Why BuildMe

**Working with an Agent should help you understand how to build and use one.**

Start with something you want to make: improve a project, write code, explore documents, or create a working tool. The Agent helps with the task. BuildMe lets you inspect how it selects tools, assembles context, calls a model, and uses tokens.

Enable a capability and observe the next turn. Give two Agents the same task and compare their approaches and artifacts. Bring what you learn to the next project.

**Create → Inspect → Configure → Compare → Share.**

For creators, developers, and students and teachers who learn through practice. Your own tasks set the direction; there are no fixed exams or rankings of learners' answers.

## What makes it different

| | What you can do |
|---|---|
| **X-ray mode** | Inspect real model calls, tool arguments and results, prompt sections, context, and subtasks. Read built-in explanations or request a deeper explanation of an event. |
| **Your Agent** | Configure nine capabilities. Tools, prompts, and runtime behavior use the same turn snapshot; changes apply to the next turn. |
| **Continuous dual chat** | Ask once; Pi and DSH stream answers side by side with separate conversation histories. Keep asking, stop runs, restore history, and compare execution and file changes. |
| **Token ledger** | Inspect reported input, output, and cache usage, tool output, and repeated context. Partial reports, estimates, and unavailable values are labeled separately. |
| **Comparison experiments** | Compare engines, two model connections, or direct reading versus searching before reading. Both sides start from independent copies of the same workspace baseline. |
| **Learning through events** | Thirty local, deterministic achievements and discovery cards respond to actual events. Learning exports omit chat text, tool arguments, and Trace contents. |
| **Community & showcase** | A separately deployable open-source service for posts, discussions, projects, search, moderation, and sharing comparison/achievement cards. |

### Two engines. One workbench.

| | Pi · Your Agent | DSH · Full engine |
|---|---|---|
| Execution | Pi Agent Core | DeepSeek Harness native Agent loop |
| Focus | Configure capabilities and explore how they work | Explore a full harness in action |
| Extension model | Cordis plugins, prompts, Skills, capability registry | Official DSH plugins and the BuildMe bridge |
| Shared experience | Chat, workspaces, model connections, X-ray, token ledger | Chat, workspaces, model connections, X-ray, token ledger |

The nine switches cover **documents, workspace search, web reading, to-do lists, planning, Skills, context compaction, subagents, and workflows**. Basic reading, writing, editing, commands, and workspace information remain available. Workflows depend on subagents; child Agents cannot delegate indefinitely.

Bring your own model: DeepSeek, other supported providers, compatible APIs, or a local model service. Model availability, tool support, and reasoning output depend on your provider. BuildMe only displays reasoning actually returned by the model.

## A good first session

1. **Bring a project.** Select a local workspace, configure a model connection, and ask for something useful.
2. **Open an answer.** Use X-ray or the token ledger to see the calls and context behind it.
3. **Change one condition.** Enable a Skill, subagents, or compaction; inspect the next turn.
4. **Ask both sides.** Continue the conversation, compare answers, tool traces, and file diffs, then choose changes to adopt.

## Quick start

Requires **Node.js 22.19+** and **pnpm**. Use Node.js 22.x if you also run the community service.

```bash
git clone https://github.com/jsdnaasd/buildme-agent.git
cd buildme-agent
pnpm install
pnpm desktop
```

Add your API key, model, and endpoint in model preferences, then select a workspace. Your chosen provider charges for API usage. The repository does not include shared credentials. The desktop interface currently primarily uses Chinese; this introduction and the product page are available in both languages.

<details>
<summary><strong>CLI and desktop packaging</strong></summary>

```bash
pnpm build
node dist/cli.js init
node dist/cli.js plugins doctor
# First configure the environment variables required by your provider locally.
node dist/cli.js run "Inspect this workspace and explain the project structure"

# Default macOS target: arm64
pnpm desktop:package
# Windows x64 packaging target; not a claim of Windows runtime validation
pnpm desktop:package:win
```

See the [runtime guide](docs/runtime-guide.md) for model, profile, plugin, and connection configuration (Chinese).

</details>

<details>
<summary><strong>Self-host the community</strong></summary>

The service has separate dependencies and requires Node.js 22.19–22.x. From the repository root:

```bash
cd community
pnpm install
cp .env.example .env
# Generate and set your own SESSION_SECRET following community/README.md.
pnpm build
pnpm dev
```

The service uses Hono, SQLite, and local file/OSS storage. Accounts, GitHub OAuth, domains, and production deployment require configuration. Public source availability does not imply a live public community. See the [community guide](community/README.md) and [deployment guide](community/deploy/README.md) (Chinese).

</details>

## Data and execution boundaries

- **Local by default.** History and configuration are stored on your machine. Relevant task contents are sent to the model provider you select; a local workbench does not imply offline inference.
- **Automatic dual execution.** Dual chat runs without per-tool approvals inside separate workspace copies. Execution-layer read-only and command isolation rules still apply. Adopting changes into original files requires a preview and conflict checks.
- **Compare observed behavior.** Using the same model helps compare harnesses, but random output differences cannot all be attributed to the harness.
- **Evidence stays honest.** Missing usage is not replaced with zero; partial usage is not presented as a full total. Provider-returned reasoning is separate from the final answer.
- **Extra calls are explicit.** Viewing local traces and achievements uses no model calls. Deep explanations, comparison summaries, and new comparison runs use your chosen model connection.

## Inside the repository

| Directory | Contents |
|---|---|
| [`desktop/`](desktop/) | Electron main process, IPC, chat, and visualizations |
| [`src/core/`](src/core/) | Pi runtime, Trace, capabilities, achievements, comparisons, workspaces |
| [`src/full/`](src/full/) | DSH bridge, event collection, and tool integration |
| [`src/plugins/`](src/plugins/) · [`bundles/`](bundles/) | Cordis plugins, system prompts, capability prompts |
| [`community/`](community/) | Complete community server, frontend, migrations, tests, deployment tools |
| [`test/`](test/) · [`scripts/`](scripts/) | Unit tests, isolated Electron acceptance fixtures, packaging |
| [`docs/`](docs/) | Product, architecture, requirements, implementation, and acceptance records |

## Status and contributions

BuildMe is under active development. macOS arm64 has actual desktop acceptance records. Windows has a packaging target; Windows and Linux desktop runtime validation remain pending. Some cross-worker DSH subtask statistics have collection limits; see the [fidelity notes](docs/xray-dsh-fidelity.md).

Contributions are welcome: reproducible issues, interface improvements, plugins, and documentation. Read [CONTRIBUTING.md](CONTRIBUTING.md). The [feature ideas](docs/feature-ideas.md) document describes proposals, not shipped features.

```bash
pnpm test
pnpm typecheck
pnpm test:typecheck
pnpm lint
pnpm build
```

## Open source and acknowledgments

**The desktop app, CLI, Agent runtime, plugins, prompts, community service, tests, and project documentation are public in this repository. BuildMe's own code is [MIT licensed](LICENSE).** Local credentials, user conversations, databases, installed dependencies, and private deployment configuration are excluded from source publication.

Built with [Pi](https://github.com/earendil-works/pi), [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), and their ecosystems. BuildMe is an independent project. Upstream copyrights and licenses are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">

**Build to understand. Understand to build.**

</div>
