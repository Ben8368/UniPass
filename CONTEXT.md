# 当前状态

> **最后确认：** 2026-09-02
> **阶段：** Manifest V3 浏览器扩展，版本 `5.3.1`；核心查询、查看/填入、目录匹配和 Jupiter 会话保活已接入。

## 当前决策

- 凭据列表先由 Service Worker 检查可用性；空密码账号不展示，Popup 仅在用户点击“查看”或“填入”后接收选中账号的明文密码。
- 填充仅允许 HTTPS 且需匹配应用 origin/path；Content Script 按用户操作临时注入，不自动提交。
- 本地 manifest 为商店版的下一补丁版，阻止浏览器用商店扩展覆盖；UniPass 网络请求默认发送构建时同步的 `STORE_PLUGIN_VERSION`（当前商店基线 `5.3.0`），每次开发/验证均在线核验。商店版变更时必须同步网络基线，并把本地构建更新为其下一补丁版；用户可临时手动覆盖三段数字请求版号，且不影响发布门禁或本地 `5.3.1`。
- 最近客观验证：2026-09-03 `npm run verify` 通过（治理检查、两次静态绿灯审计、21 项测试、类型检查和构建）；TD-002 的真实 Chrome/Jupiter 烟测仍待人工执行。目录、凭据与 Jupiter 保活优先以服务端 ID 隔离，缺失时回退到服务端登录名或邮箱；账户页昵称仅在 Popup 内存中作为用户名悬停提示。木星单页应用仅在其已授权同源内允许路由变化。UniPass/Jupiter 请求与 JSON 解析统一为 12 秒超时。真实 UniPass/Jupiter 登录态仍需浏览器手动验收。
- 私人本地构建以商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 key 固定 ID；每次验证动态查询商店版号，并强制本地与之同主、次版本且补丁号恰高 `1`；每个新商店基线只发布一次对应 GitHub Release。仅允许开发者模式加载，不具备商店发布或签名权。

## 近期优先级

1. 用真实 UniPass 会话验证账户页昵称（`fullName` 或 `username`）显示、空密码隐藏、正常凭据查看/填入、路径匹配和 HTTP 拒绝。
2. 验证 Jupiter 保活在浏览器重启、登录失效和用户切换场景下的行为（TD-002）。

## 按需入口

- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 审查与验证：[docs/AI_RULES.md](docs/AI_RULES.md)
- 活跃技术债：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 长期决策：[docs/ADR/README.md](docs/ADR/README.md)
