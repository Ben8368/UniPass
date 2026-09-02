# ADR 0001: AI 协作入口与红绿灯验证闭环

- 状态：已接受
- 日期：2026-09-01

## 背景

UniPass 是处理账号、密码和外部会话的浏览器扩展，AI 高频改动若缺少统一入口，容易出现权限扩张、构建通过冒充真实验收、文档漂移或安全边界被局部修改。

## 决策

- `AGENTS.md` 作为通用 AI 治理入口。
- 每轮先读 `CONTEXT.md` 和 `LESSONS.md`，再按任务加载架构、安全或发布文档。
- 源码、CI、权限和安全边界改动后，先输出 `🚦 Audit Report`，再运行 `npm run verify`。
- 红灯必须当前修复；跨任务黄灯进入 `TECH_DEBT.md`。
- 当前事实、架构、安全、审查规则和长期决策各自保持单一权威位置。
- 不采用 MediaToolbox 的绿灯自动提交规则；commit 和 push 只在用户明确要求时执行。

## 后果

好处：凭据与权限风险会在验证前显式暴露，CI 和本地使用同一验证入口，状态与历史不混在强制加载文档中。

代价：治理文档需要维护；真实 Chrome 与外部登录态仍需要人工验收，不能完全自动化。

## 关联文档

- [AGENTS.md](../../AGENTS.md)
- [AI_RULES.md](../AI_RULES.md)
- [GOVERNANCE.md](../GOVERNANCE.md)
- [SECURITY.md](../../SECURITY.md)
