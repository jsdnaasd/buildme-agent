# BuildMe 社区进度

更新：2026-10-05。需求基准：prd-community.md v1.1。首批 C0–C2，后续 C3–C8。

## 当前状态

C0、C1、C2 已完成。首批交付止于 C2，不推送、不部署；C3–C8 尚未实施。

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
- Session Cookie 始终使用 Secure，开发浏览器使用 localhost。浏览器联合验收已随 C2 完成，真实 GitHub/OSS 配置仍待人工验收。

## C2 验收

- 内容：板块与标签、快速分享和长文、最新列表、详情、编辑与软删除、最近十次历史、FTS5 全文索引同步均已实现。
- 链接与图片：来源识别、24 小时元数据缓存、七天内重复链接提示、点击跳转与去重；DNS 地址固定到请求、每次重定向重新校验；图片实际解码、尺寸限制、去 EXIF、WebP 和缩略图已实现。
- 编辑器：统一 Markdown 渲染与过滤、预览、代码高亮和复制、目录、表情、图片上传/粘贴/拖入、失败重试、本地与服务器草稿；快速发布通过渐进增强更新列表。
- 提前交付基本回复、帖子点赞、首帖待审和管理员通过入口；用户链接提供基础身份页，完整个人内容汇总留到 C4。
- 社区 Node 22：26 项测试通过，名称覆盖 S-2、D-3、U-1–U-9、P-1–P-12。包含恶意 Markdown、私有地址和重定向、真实约 5.9 MB 带 EXIF 图片、伪造图片、并发邀请码、失效会话和草稿隔离。
- Google Chrome：4 项浏览器验收通过，覆盖关闭 JavaScript 后注册→发布→审核→回复/点赞、本地与服务器草稿恢复、上传/预览/发布、浅深主题、390px 多页面、嵌入 Cookie 持续生效；页面资源无第三方请求。截图位于 `community/output/playwright/`。
- 社区最终 typecheck、lint、build 通过；主仓库最终 20 个测试文件、234 项测试以及 typecheck、test:typecheck、lint、build 全部通过。主仓库测试数随其他并行开发增长，本批未修改其业务代码。
- GitHub 授权和外链解析使用本地 HTTP 测试桩。真实 OAuth 授权、OSS 读写及 Electron 内嵌不计为本批已验收。

## 继续开发入口

启动、管理员创建和检查命令见 `community/README.md`。开发示例仅由 `pnpm seed` 显式生成。下一阶段为 C3 完整互动与通知。
