# 当前状态

> **最后确认：** 2026-09-15
> **阶段：** Manifest V3 扩展，版本 `5.3.4`；核心功能与发布前门禁已完成，本轮 WebDAV 权限回收待真实服务验收。

## 当前决策

- Normal/Advanced 都完整展示账号和备注；账号级可用性检查和应用级过滤均由 Service Worker 执行，应用列表只展示至少含一个可用账号的应用，并区分空密码、凭据验证失败和账号目录失败。Normal 允许使用账号密码 Fill，但 plaintext password 不返回 Popup/浮层；Advanced 通过 ephemeral capability 额外允许 Reveal、Credential panel 和 Copy Password。
- 填充仅允许 HTTPS 且需匹配应用 origin/path；Content Script 按用户操作临时注入，不自动提交。
- UniPass 离线状态的一键登录由用户点击触发，只在一个标签页、两分钟窗口内操作精确的门户登录页和固定 Tec-IAM 飞书 OAuth 授权页；不读取或保存 Cookie、授权码和飞书页面数据，非预期身份验证由用户处理。
- 本地 manifest 为商店版的下一补丁版；UniPass 网络请求默认发送随产物生成的 `runtime-config.json` 网络基线（当前 `5.3.3`）。商店版变更时必须同步网络基线，并把本地构建更新为其下一补丁版；用户可临时手动覆盖三段数字请求版号。
- 设置页恢复默认后，在固定 `1400ms` 内连续两击保存会显示“解锁高级模式”。Popup/浮层完成 `enableAdvancedMode` 后以 `sender.documentId` 绑定 `unipass-advanced-mode` Port；断开、页面结束或 Service Worker 重启即撤销。Normal 仍完整显示账号并允许选择、打开应用和 Fill，未进入时只隐藏 Reveal UI。Self Build 的隐藏三击、版本范围、WASM/manifest 复用和 fail-closed 规则保持不变。
- UniPass AES-ECB-PKCS7 解密及 Jupiter 的 MD5/DES-ECB-PKCS7 密码转换已迁入随扩展本地打包的 Rust `credential-core.wasm`；availability 在 WASM 内只返回状态，Jupiter keepalive 从 UniPass ciphertext 直接得到 transformed password，JS 不再接触原始 Jupiter 明文。普通构建固定 `stable-v1` 材料，hardened 构建由 `UNIPASS_HARDEN_SEED` 生成 3～5 个 fragment、重排和轻量算术重构；JS/WASM 仍完全自包含。该措施只提高静态分析成本，动态调试仍可能取得运行时材料或明文；继续使用客户端解密是当前产品计划。
- Rust 构建统一启用 workspace、Cargo registry 与 toolchain path remap；hardened 构建默认要求 Binaryen `wasm-opt`，缺失即 fail closed，报告与 integrity 仅写入 `artifacts/hardened/`。普通 WASM 保持 byte-for-byte reproducibility；hardened seed 还选择 4 种有限等价 reconstruction strategy 之一。
- Legacy UniPass 仍在使用；`credential-core` 新增职责冻结为 Legacy compatibility，新的 Vault AES-GCM 等能力不迁入 WASM；退役与 core 收缩见 [ADR 0003](docs/ADR/0003-crypto-boundary-and-legacy-retirement.md) / [TD-009](docs/TECH_DEBT.md)。`legacy-unipass` 与 WebDAV 分离，禁止双写。
- WebDAV 状态机区分新建、接入远端和重连本地 profile；新设备用 endpoint + WebDAV credential + Vault Key 解密远端 manifest，旧 ID 经验证后迁移。credential 与 Vault Key 以设备密钥加密长期保存，浏览器重启后自动恢复；查看密码和 Advanced 优先用系统 WebAuthn，失败回退 4 至 32 位备用 PIN，扩展不读取系统 PIN。新建只显示一次恢复 Key，缺失 fail closed；对象分离，ETag 冲突 fail closed。
- 验证：2026-09-15 默认门禁与 Chrome smoke 通过；144 项测试、依赖审计、类型检查、Rust QA、构建和产物审计通过。WebDAV 权限提示/回收待真实服务验收；其余集成验收于 2026-09-14 完成。
- 本地构建以商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 key 固定 ID；每次验证动态查询商店版号，并强制本地与之同主、次版本且补丁号恰高 `1`；每个新商店基线只发布一次对应 GitHub Release。仅允许开发者模式加载，不具备商店发布或签名权。

## 近期优先级

1. 当前版本功能与验收已收口；后续按需发布。Jupiter 新适配取消，长期仅保留 `TD-009` 的 Legacy UniPass 退役与 `credential-core` 收缩。

## 按需入口

- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 审查与验证：[docs/AI_RULES.md](docs/AI_RULES.md)
- 活跃技术债：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 长期决策：[docs/ADR/README.md](docs/ADR/README.md)
