# 技术债追踪

> 红绿灯审查中需要跨任务跟进的黄灯进入本文；红灯不得以登记债务代替修复。

## 分级

| 等级 | 含义 | 处理要求 |
| --- | --- | --- |
| P0 | 正确性或安全阻断 | 当前任务修复；影响阶段时在 `CONTEXT.md` 标记 |
| P1 | 用户体验、可靠性或维护风险 | 下个相关迭代优先处理 |
| P2 | 长期结构优化 | 扩展相关能力前处理 |

## 未偿还债务

### TD-006: 空密码账号/应用过滤

- **等级：** P1
- **状态：** Open
- **位置：** `src/popup/catalog.ts`、`src/background/credential-availability.ts`
- **问题：** 账号级可用性检查已经存在，但应用列表仍展示包含空密码账号的应用；用户进入应用列表时会看到无法填充的应用。
- **方向：** 在不向 Popup 批量返回明文密码的前提下，按 Service Worker 返回的可用性状态过滤应用卡片；空密码、解密失败和部分目录失败必须保持可解释的区别，并补充回归测试。
- **验收：** 空密码账号所属应用不在应用列表显示；存在至少一个可用账号的应用正常显示；解密失败不被伪装为空密码；Normal/Advanced 和 Popup/浮层行为一致。


## 已归档

- TD-004 认证服务端化与客户端长期凭据退出：已于 2026-09-11 关闭，当前产品决定继续使用客户端解密；客户端明文短暂可见仍是已接受边界，详见 [归档记录](archive/tech-debt/TD-004-client-decryption-accepted.md)。
- TD-005 Rust credential core hardening：已完成仓库侧 ABI、Rust QA、可复现 WASM、产物审计、Chrome smoke、Release gate 与供应链收尾；真实账号路径保留为人工验收，详见 [归档记录](archive/tech-debt/TD-005-rust-credential-core-hardening.md)。

## 偿还流程

1. 红绿灯或用户反馈识别问题并分级。
2. 修复时补测试或明确真实浏览器验收。
3. 完成后从活跃清单移除；需要保留复盘时移入 `docs/archive/tech-debt/`，Git 历史保留变更依据。
