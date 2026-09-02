# AI 协作规范

`AGENTS.md` 是本仓库 AI 协作的唯一入口。规则细节只在对应权威文档中维护，不在入口重复。

## 开局与按需读取

所有任务先读 [CONTEXT.md](CONTEXT.md) 和 [LESSONS.md](LESSONS.md)，再按任务读取：

| 任务 | 必读文档 |
| --- | --- |
| 任意源码改动 | [docs/AI_RULES.md](docs/AI_RULES.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 凭据、会话、存储、网络或权限 | [SECURITY.md](SECURITY.md) |
| Popup、Service Worker、Content Script 或消息契约 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 验收、CI 或发布 | [README.md](README.md)、[CONTRIBUTING.md](CONTRIBUTING.md) |
| 技术债或阶段状态 | [docs/TECH_DEBT.md](docs/TECH_DEBT.md)、[CONTEXT.md](CONTEXT.md) |
| 治理文档改动 | [docs/GOVERNANCE.md](docs/GOVERNANCE.md) |
| 长期架构决策 | [docs/ADR/README.md](docs/ADR/README.md) |

## 不可跨越的边界

- Popup 只负责展示与用户操作；UniPass/Jupiter 网络请求和敏感状态留在 Service Worker。
- 明文密码不得写入 `localStorage`、`chrome.storage`、日志、缓存或构建产物；仅在用户明确查看/填入时进入 Popup。
- 填充只允许 HTTPS、匹配的应用页面，必须由用户触发，不自动提交表单。
- Content Script 仅在用户点击“填入”后注入，不注册常驻脚本，不扩大到 `<all_urls>`。
- 新增权限、主机、持久化字段或第三方请求前必须更新 `SECURITY.md` 与 manifest，并在红绿灯审查中说明。

## 执行与汇报

- 源码改动后先按 `docs/AI_RULES.md` 输出 `🚦 Audit Report`，再运行默认验证 `npm run verify`。
- 客观验证必须真实运行；需要登录态、浏览器交互或真实外部服务的主观/集成验收不得用 build 代替。
- 只更新事实所属的权威文档：当前决策进 `CONTEXT.md`，债务进 `TECH_DEBT.md`，规则进 `AI_RULES.md`，长期决策进 ADR。
- 未经用户明确要求，不自动 commit 或 push。默认用中文汇报，命令、路径、API 字段和代码标识保留原文。

## 治理文档自治理

- 治理文档遵守 [docs/GOVERNANCE.md](docs/GOVERNANCE.md) 的单一事实源、篇幅预算和归档规则。
- 改动治理文档后运行 `npm run docs:governance:check`；源码或 CI 改动仍运行完整 `npm run verify`。
- `AGENTS.md`、`CONTEXT.md`、`LESSONS.md` 是强制加载面，只保留路由、当前事实和索引。
