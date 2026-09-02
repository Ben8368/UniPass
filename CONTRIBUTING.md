# 贡献指南

UniPass 是处理敏感凭据的 Manifest V3 扩展。人类贡献入口以本文为主；AI 协作规则以 [AGENTS.md](AGENTS.md) 和 [docs/AI_RULES.md](docs/AI_RULES.md) 为准。

## 开发与验证

- 使用 Node.js 22 或更高版本。
- 安装依赖：`npm install`。
- 完整验证：`npm run verify`。
- 只检查治理文档：`npm run docs:governance:check`。
- 构建后在 `chrome://extensions` 以开发者模式加载 `dist/`。

`npm run verify` 会依次执行治理检查、测试、TypeScript 类型检查和扩展构建。真实 UniPass/Jupiter 登录、Cookie、alarm 和页面注入仍需浏览器手动验收。

## 改动要求

- 修改凭据、会话、URL、权限、存储或 Content Script 前阅读 [SECURITY.md](SECURITY.md)。
- 新权限和 host permission 必须说明用途、触发条件、敏感数据和关闭路径。
- 不提交 `.env`、密码、token、真实 API 响应、用户账号目录或构建产物。
- 跨上下文消息变化必须同步 `src/shared/types.ts`、发送端、接收端和测试。
- 用户可见错误、空态和加载态应可读；不能把外部服务失败静默转换成空数据。

## 提交与 PR

- 建议使用短生命周期分支；commit 可采用 `feat:`、`fix:`、`docs:`、`test:` 等 Conventional Commit 前缀。
- 提交和 push 由维护者或用户明确决定，自动化工具不得因绿灯自行执行。
- PR 描述应包含改动目的、风险边界、`🚦 Audit Report`、验证命令与结果，以及未完成的真实浏览器验收。
- 版本发布前确保 `package.json`、`public/manifest.json` 和 tag 一致，并由 Release workflow 生成 ZIP 与 SHA-256。
