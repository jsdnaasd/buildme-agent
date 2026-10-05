# BuildMe 社区

独立网站，使用 Node.js 22（至少 22.19）和 pnpm。请在本目录执行所有命令；依赖、锁文件和数据不与桌面端混用。

## 本地运行

1. 使用 Node.js 22，运行 `pnpm install`。
2. 将 `.env.example` 复制为 `.env`，按其中命令生成自己的 `SESSION_SECRET`，写入 `.env`。不要提交该文件。
3. 运行 `pnpm build`，编译服务并复制本站字体；开发前也需执行一次。
4. 运行 `pnpm dev`，打开 http://localhost:3100。生产产物使用 `pnpm start`。

数据库位于 `DATA_DIR/community.sqlite`，启动时自动执行编号迁移；图片位于 `DATA_DIR/media`。删除数据库会丢失账号与内容，日常开发无需删除。

## 检查

在本目录分别运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。生产环境目标为 Node.js 22；其他 Node 主版本的原生 SQLite 模块不能直接混用。

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
