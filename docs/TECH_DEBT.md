# 技术债追踪

> 红绿灯审查中需要跨任务跟进的黄灯进入本文；红灯不得以登记债务代替修复。

## 分级

| 等级 | 含义 | 处理要求 |
| --- | --- | --- |
| P0 | 正确性或安全阻断 | 当前任务修复；影响阶段时在 `CONTEXT.md` 标记 |
| P1 | 用户体验、可靠性或维护风险 | 下个相关迭代优先处理 |
| P2 | 长期结构优化 | 扩展相关能力前处理 |

## 未偿还债务

- TD-009 Legacy UniPass 退役与 credential-core 收缩（P2，未偿还）：Legacy 被正式判定可退役后，删除 Legacy UniPass/Jupiter 运行能力、`credential-core` 中仅为 Legacy 存在的实现和 ABI、无用途的 Rust crypto dependencies，并清理对应测试和 artifact 规则；检查并清理 WASM build/hardening/audit/release infrastructure；若项目不再需要 WASM，删除 WASM-specific CSP 和构建特殊路径；同步 `ARCHITECTURE.md`、`SECURITY.md`、`CONTEXT.md`，运行完整验证并完成适用的真实 Chrome 人工验收。详见 [ADR 0003](ADR/0003-crypto-boundary-and-legacy-retirement.md)。

## 已归档

- TD-008 本地解锁密码：已于 2026-09-14 关闭；采用 PBKDF2-SHA-256 + AES-256-GCM 加密封装，失败计数仅 session，达到上限 fail closed，支持显式 lock/disable/remove；详见 [归档记录](archive/tech-debt/TD-008-local-unlock.md)。

- TD-007 设置页职责拆分：已于 2026-09-13 关闭；WebDAV 连接表单迁入 `webdav-settings.ts`，当前页账号创建迁入 `current-page-account.ts`。
- TD-006 空密码账号/应用过滤：已于 2026-09-11 关闭，详见 [归档记录](archive/tech-debt/TD-006-empty-password-filter.md)。
- TD-004 认证服务端化与客户端长期凭据退出：已于 2026-09-11 关闭，当前产品决定继续使用客户端解密；客户端明文短暂可见仍是已接受边界，详见 [归档记录](archive/tech-debt/TD-004-client-decryption-accepted.md)。
- TD-005 Rust credential core hardening：已完成仓库侧 ABI、Rust QA、可复现 WASM、产物审计、Chrome smoke、Release gate 与供应链收尾；真实账号路径保留为人工验收，详见 [归档记录](archive/tech-debt/TD-005-rust-credential-core-hardening.md)。

## 偿还流程

1. 红绿灯或用户反馈识别问题并分级。
2. 修复时补测试或明确真实浏览器验收。
3. 完成后从活跃清单移除；需要保留复盘时移入 `docs/archive/tech-debt/`，Git 历史保留变更依据。
