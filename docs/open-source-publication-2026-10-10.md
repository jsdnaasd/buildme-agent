# BuildMe 公开源码与双语介绍 · 2026-10-10

本次公开内容包括桌面端、CLI、Pi / DSH 接入、Cordis 插件、提示词、测试、文档，以及独立的 `community/` 服务端和前端。BuildMe 自有代码使用 MIT 许可证；第三方许可保留。

## 当前产品介绍

- `README.md`、`README.en.md`：中文/英文 GitHub 首页。
- `docs/site/`：无外部依赖的双语产品介绍页；`.github/workflows/pages.yml` 仅发布此目录到 GitHub Pages。
- `docs/product-brief.md`：当前产品理念与特点，替代旧的内部共创任务说明。
- `docs/architecture.md`、`docs/runtime-guide.md`：纠正双引擎定位，保留开发配置说明。
- `CONTRIBUTING.md`：中英文贡献与验证说明。

对外定位为通用 Agent 创作与学习工作台：**把 AI 的能力，变成你的能力。Build to understand. Understand to build.** 展示已实现的双路连续聊天、X 光、能力开关、Token 账单、成就、讲解和社区；未来构想及未验证平台分别注明。

## 发布前验证

- 桌面：`pnpm exec vitest run --maxWorkers 1`，28 个文件、294 项通过。
- 桌面：`pnpm typecheck`、`pnpm test:typecheck`、`pnpm lint`、`pnpm build` 通过。
- 社区：Node.js 22.23.3 下 `pnpm --dir community test`，10 个文件、64 项通过；`typecheck`、`lint`、`build` 通过。
- 文档：检查 9 份介绍/指南中的 95 个本地及本仓库链接，均存在；Pages 配置仅上传 `docs/site`。
- 页面：中英文语言切换通过；1280px 桌面与窄屏布局已检查，425px 两种语言无整页横向溢出。另有 390px 中英文及 320px 英文检查；代码块在自身容器内横向滚动。
- `git diff --check` 通过。
- 待发布文件未发现本机 `.env`、数据库或私钥文件；常见凭据格式检查命中测试假值。另扫描 Git 历史 622 个 blob，45 次测试 Token 匹配，无未分类的常见 Token / 私钥格式命中。此扫描不等于对所有秘密格式的保证。

测试不调用真实模型 API。本次没有重跑系统级桌面完整验收，也没有新增 Windows / Linux 桌面实测。私有部署记录、本机配置、聊天和数据库不发布；通用部署代码与配置模板公开。
