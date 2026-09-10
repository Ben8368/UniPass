# 贡献指南

UniPass 是处理敏感凭据的 Manifest V3 扩展。人类贡献入口以本文为主；AI 协作规则以 [AGENTS.md](AGENTS.md) 和 [docs/AI_RULES.md](docs/AI_RULES.md) 为准。

## 开发与验证

- 使用 Node.js 22 或更高版本。
- 安装依赖：`npm install`。
- 普通验证：`npm run verify`；实际安装目录验证：`npm run verify:hardened`；发布前追加 `npm run verify:wasm-reproducible`。
- 只检查治理文档：`npm run docs:governance:check`。
- 构建后在 `chrome://extensions` 以开发者模式加载 `dist/`。

`npm run verify` 会依次执行治理检查、动态商店版号静态审计、完整 Rust QA、测试、TypeScript 类型检查、标准压缩构建和最终产物审计；`npm run verify:hardened` 会强制 Binaryen `wasm-opt`、构建 hardened `dist/`、审计运行文件与 `artifacts/hardened/` 元数据、验证多个 strategy/vector，并运行 hardened Chrome smoke。真实 UniPass/飞书 OAuth/Jupiter、Cookie、alarm 和页面注入仍需按 [Chrome 验收清单](docs/CHROME-ACCEPTANCE.md) 手动验收，已完成状态以 [CONTEXT.md](CONTEXT.md) 和 [docs/TECH_DEBT.md](docs/TECH_DEBT.md) 为准。

## 改动要求

- 修改凭据、会话、URL、权限、存储或 Content Script 前阅读 [SECURITY.md](SECURITY.md)。
- 新权限和 host permission 必须说明用途、触发条件、敏感数据和关闭路径。
- 不提交 `.env`、密码、token、真实 API 响应、用户账号目录或构建产物。
- 新增或重命名构建产物时同步 `scripts/release-artifact-check.mjs` 的精确白名单和正反例测试；不得通过放宽扫描绕过失败。
- 跨上下文消息变化必须同步 `src/shared/types.ts`、发送端、接收端和测试。
- 用户可见错误、空态和加载态应可读；不能把外部服务失败静默转换成空数据。

## 提交与 PR

- 建议使用短生命周期分支；commit 可采用 `feat:`、`fix:`、`docs:`、`test:` 等 Conventional Commit 前缀。
- 提交和 push 由维护者或用户明确决定，自动化工具不得因绿灯自行执行。
- PR 描述应包含改动目的、风险边界、`🚦 Audit Report`、验证命令与结果，以及未完成的真实浏览器验收。
- 仅在[替身门禁](docs/AI_RULES.md#5-私人本地替身门禁)要求的首次跟随发布时创建 tag；发布前确保 `package.json`、`public/manifest.json` 和 tag 一致，并由 Release workflow 生成 ZIP 与 SHA-256。
- 商店基线未变化时，后续 `main` 改动保持同一本地替身版号，不移动既有 tag、不覆盖 Release，也不重复发布；当前源码由本地构建或对应 CI artifact 验证。
