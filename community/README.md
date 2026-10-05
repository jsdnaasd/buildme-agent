# BuildMe 社区

独立网站，使用 Node.js 22（至少 22.19）和 pnpm。请在本目录执行所有命令；依赖、锁文件和数据不与桌面端混用。

## 本地运行

1. 使用 Node.js 22，运行 `pnpm install`。
2. 将 `.env.example` 复制为 `.env`，按其中命令生成自己的 `SESSION_SECRET`，写入 `.env`。不要提交该文件。
3. 运行 `pnpm build`，编译服务并复制本站字体；开发前也需执行一次。
4. 可选：运行 `pnpm seed`，显式生成四篇带有“示例”标记的开发内容；不会创建可登录的默认账号或虚构互动数。
5. 运行 `pnpm dev`，打开 [本地社区](http://localhost:3100)。构建产物使用 `pnpm start`。

数据库位于 `DATA_DIR/community.sqlite`，启动时自动执行编号迁移；图片位于 `DATA_DIR/media`。删除数据库会丢失账号与内容，日常开发无需删除。

## 检查

在本目录分别运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。生产环境目标为 Node.js 22；其他 Node 主版本的原生 SQLite 模块不能直接混用。

`pnpm test:browser` 使用本机 Google Chrome，启动独立的临时数据库和 3198 端口服务，完成后清理测试数据。覆盖无 JavaScript 注册与发帖、首帖审核、回复和点赞、草稿恢复、图片与 Markdown、浅深主题、390px 布局和嵌入外壳。截图写入 `output/playwright/`。单元与接口测试中的 GitHub、链接元数据均使用本地测试桩。

## 架构

- Hono JSX 输出 HTML，原生 JavaScript 渐进增强，不使用前端框架。
- 数据库采用 better-sqlite3、WAL 和编号 SQL 迁移。
- `STORAGE_DRIVER=local` 使用磁盘；切到 `oss` 需完整配置 `.env.example` 的 OSS 参数。
- 样式、脚本、图标、字体均为本站资源；字体许可随构建复制至 public/fonts。
- `/healthz` 执行数据库读写；`?embed=1&theme=dark` 预览 App 嵌入外壳。

本批交付不执行部署。完整 Ubuntu/Caddy/systemd 部署、备份与恢复脚本在 C8 交付。

## 账号

运行 `pnpm create-admin`，按提示输入用户名和隐藏的密码。打开 `/login` 登录后，在 `/admin` 生成邀请码。邀请码仅在生成时显示一次；已有邀请码列表只显示标识与使用次数。用户在 `/register` 注册，设置页为 `/settings`。

GitHub OAuth App 的回调地址设为 `${SITE_URL}/auth/github/callback`，配置 `.env` 中的 client ID 和 secret。未配置时入口隐藏。授权使用 state 和 PKCE，访问令牌只用于读取资料，不持久保存。

本地请使用 `localhost`（不使用局域网 HTTP 地址）；会话 Cookie 始终带 Secure、HttpOnly、SameSite=Lax。线上必须由 HTTPS 反向代理提供服务。仅在自有代理会重写 X-Forwarded-For 时设置 TRUST_PROXY=true。

## 发帖与审核

登录后可在 `/latest` 快速分享，或进入 `/new` 编写 Markdown 长文；编辑器提供同源预览、工具栏、代码高亮、目录、表情和图片粘贴/拖入。关闭 JavaScript 时仍可通过普通表单上传图片、预览、发布、回复和点赞。

本地草稿每五秒保存，可手动恢复；服务器草稿在 `/drafts` 管理。发布后可从详情页编辑、查看最近十次历史和软删除。新用户首帖默认待审，管理员在 `/admin/review` 通过后才公开展示。

链接元数据和缩略图先缓存到本站，外链通过 `/go/:id` 跳转。Markdown 中未经本站上传的外站图片显示为普通链接。全文索引随发布、编辑和删除更新，搜索页面在 C4 开放。

## 本批范围

C0–C2 已交付；完整楼层互动与通知、搜索和个人内容汇总、作品墙、完整管理后台、Electron 集成及部署准备分别留到 C3–C8。热门、精华、搜索和作品入口暂未开放。真实 GitHub OAuth 和 OSS 需要负责人提供配置后人工验收；当前本地存储和邀请码流程可独立运行。

阶段结果见 [社区进度](../docs/community-progress.md)，配置与阶段约定见 [待配置事项](../docs/community-open-questions.md)。
