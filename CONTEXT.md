# 当前状态

> **最后确认：** 2026-09-02
> **阶段：** Manifest V3 浏览器扩展，版本 `5.3.1`；核心查询、查看/填入、目录匹配和 Jupiter 会话保活已接入。

## 当前决策

- 凭据列表先由 Service Worker 检查可用性；空密码账号不展示，Popup 仅在用户点击“查看”或“填入”后接收选中账号的明文密码。
- 填充仅允许 HTTPS 且需匹配应用 origin/path；Content Script 按用户操作临时注入，不自动提交。
- UniPass 网络请求始终发送 `chrome.runtime.getManifest().version`；商店 CRX 版号只在验证时由官方更新接口动态核验，不在扩展运行时缓存或回退。
- 最近客观验证：2026-09-02 `npm run verify` 通过（治理检查、静态绿灯审计、11 项测试、类型检查和构建）；TD-001 已完成。真实 UniPass/Jupiter 登录态仍需浏览器手动验收。
- 私人本地构建以商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 key 固定 ID；每次验证动态查询商店版号，并强制本地与之同主、次版本且补丁号恰高 `1`；每个新商店基线只发布一次对应 GitHub Release。仅允许开发者模式加载，不具备商店发布或签名权。

## 近期优先级

1. 用真实 UniPass 会话验证空密码隐藏、正常凭据查看/填入、路径匹配和 HTTP 拒绝。
2. 验证 Jupiter 保活在浏览器重启、登录失效和用户切换场景下的行为（TD-002）。

## 按需入口

- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 审查与验证：[docs/AI_RULES.md](docs/AI_RULES.md)
- 活跃技术债：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 长期决策：[docs/ADR/README.md](docs/ADR/README.md)
