# 当前状态

> **最后确认：** 2026-09-10
> **阶段：** Manifest V3 浏览器扩展，版本 `5.3.3`；核心查询、查看/填入、目录匹配、UniPass 一键登录和 Jupiter 会话保活已接入。

## 当前决策

- 凭据列表先由 Service Worker 检查可用性；空密码账号不展示，Popup 仅在用户点击“查看”或“填入”后接收选中账号的明文密码。
- 填充仅允许 HTTPS 且需匹配应用 origin/path；Content Script 按用户操作临时注入，不自动提交。
- UniPass 离线状态的一键登录由用户点击触发，只在一个标签页、两分钟窗口内操作精确的门户登录页和固定 Tec-IAM 飞书 OAuth 授权页；不读取或保存 Cookie、授权码和飞书页面数据，非预期身份验证由用户处理。
- 本地 manifest 为商店版的下一补丁版，阻止浏览器用商店扩展覆盖；UniPass 网络请求默认发送构建时同步的 `STORE_PLUGIN_VERSION`（当前商店基线 `5.3.2`），每次开发/验证均在线核验。商店版变更时必须同步网络基线，并把本地构建更新为其下一补丁版；用户可临时手动覆盖三段数字请求版号，且不影响发布门禁或本地 `5.3.3`。
- UniPass AES-ECB-PKCS7 解密及 Jupiter 的 MD5/DES-ECB-PKCS7 密码转换已迁入随扩展本地打包的 Rust `credential-core.wasm`；availability 在 WASM 内只返回状态，Jupiter keepalive 从 UniPass ciphertext 直接得到 transformed password，JS 不再接触原始 Jupiter 明文。普通构建固定 `stable-v1` 材料，hardened 构建由 `UNIPASS_HARDEN_SEED` 生成 3～5 个 fragment、重排和轻量算术重构；JS/WASM 仍完全自包含。该措施只提高静态分析成本，动态调试仍可能取得运行时材料或明文；TD-004 为外部依赖阻断。
- Rust 构建统一启用 workspace、Cargo registry 与 toolchain path remap；hardened 构建默认要求 Binaryen `wasm-opt`，缺失即 fail closed，报告与 integrity 仅写入 `artifacts/hardened/`。普通 WASM 保持 byte-for-byte reproducibility；hardened seed 还选择 4 种有限等价 reconstruction strategy 之一。
- 最近客观验证：2026-09-10 `npm run verify`、`npm run verify:wasm-reproducible`、`npm run verify:hardened` 均通过，包含 Rust 1.98.1 QA、65 项 Node/WASM 测试、类型检查、普通/硬化产物审计、四 seed strategy/vector 验证和 Chromium smoke；WASM 分析确认无 imports、仅当前 exports、无项目 `src/*.rs` path。Chrome smoke 使用 Edge 兼容路径；真实 UniPass/Jupiter 登录仍按 [Chrome 验收清单](docs/CHROME-ACCEPTANCE.md) 人工复验，未执行项不视为通过。
- 私人本地构建以商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 key 固定 ID；每次验证动态查询商店版号，并强制本地与之同主、次版本且补丁号恰高 `1`；每个新商店基线只发布一次对应 GitHub Release。仅允许开发者模式加载，不具备商店发布或签名权。

## 近期优先级

1. 维护 TD-004：仅在获得 UniPass 及目标应用后端权限和版本化接口契约后重新评估认证服务端化；TD-005 已归档，真实账号路径按清单持续人工验收。

## 按需入口

- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 审查与验证：[docs/AI_RULES.md](docs/AI_RULES.md)
- 活跃技术债：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 长期决策：[docs/ADR/README.md](docs/ADR/README.md)
