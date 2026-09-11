# 技术债追踪

> 红绿灯审查中需要跨任务跟进的黄灯进入本文；红灯不得以登记债务代替修复。

## 分级

| 等级 | 含义 | 处理要求 |
| --- | --- | --- |
| P0 | 正确性或安全阻断 | 当前任务修复；影响阶段时在 `CONTEXT.md` 标记 |
| P1 | 用户体验、可靠性或维护风险 | 下个相关迭代优先处理 |
| P2 | 长期结构优化 | 扩展相关能力前处理 |

## 未偿还债务

- TD-007 `settings.ts` 已承载主题、WebDAV 地址、版本兼容和高级模式状态机，当前 389 行；不影响安全边界和功能门禁，后续相关 UI 迭代时拆分为职责更单一的控制器。


## 已归档

- TD-006 空密码账号/应用过滤：已于 2026-09-11 关闭，详见 [归档记录](archive/tech-debt/TD-006-empty-password-filter.md)。
- TD-004 认证服务端化与客户端长期凭据退出：已于 2026-09-11 关闭，当前产品决定继续使用客户端解密；客户端明文短暂可见仍是已接受边界，详见 [归档记录](archive/tech-debt/TD-004-client-decryption-accepted.md)。
- TD-005 Rust credential core hardening：已完成仓库侧 ABI、Rust QA、可复现 WASM、产物审计、Chrome smoke、Release gate 与供应链收尾；真实账号路径保留为人工验收，详见 [归档记录](archive/tech-debt/TD-005-rust-credential-core-hardening.md)。

## 偿还流程

1. 红绿灯或用户反馈识别问题并分级。
2. 修复时补测试或明确真实浏览器验收。
3. 完成后从活跃清单移除；需要保留复盘时移入 `docs/archive/tech-debt/`，Git 历史保留变更依据。
