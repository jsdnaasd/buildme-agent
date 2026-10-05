# BuildMe 社区进度

更新：2026-10-05。需求基准：prd-community.md v1.1。首批 C0–C2，后续 C3–C8。

## 当前状态

C0、C1 已完成；C2 实施中。独立工程、数据库迁移、存储接口、SSR 外壳和配置已建立。

## 基线

实施前主仓库：15 个测试文件、151 项通过；typecheck、test:typecheck、lint 通过。桌面端已有未提交改动属于其他工作，本批不纳入提交。

## C0 验收

- 社区 Node 22：3 项测试通过（D-3、S-2、本地存储读写）；typecheck、lint、build 通过。
- 主仓库：15 个测试文件、156 项通过；typecheck、test:typecheck、lint、build 通过。执行期间另一批桌面端工作新增测试，本批未改动其文件。
- 根目录仅隔离 pnpm 工作区、Vitest 与 ESLint；社区使用独立锁文件，桌面端打包流程未改变。
- 静态字体、CSS、JS 为本站资源；样图 token 保持一致。OSS 驱动已实现，尚未连接真实 OSS。真实浏览器联合验收在 C2 完成后执行。

## C1 验收

- 社区 Node 22：12 项测试通过，覆盖 U-1–U-9、邀请码并发耗尽、CSRF 与管理权限；typecheck、lint、build 通过。
- GitHub 授权使用真实本地 HTTP 测试桩，验证 token 不落库；未访问真实 GitHub。
- 主仓库：156 项测试与 typecheck、test:typecheck、lint、build 全部通过。
- 账号设置、GitHub 绑定、头像处理、邀请码管理、密码重置和隐藏输入的创建管理员脚本已交付。
- Session Cookie 始终使用 Secure，开发浏览器使用 localhost。真实 GitHub/OSS 配置与浏览器联合验收尚未执行。
