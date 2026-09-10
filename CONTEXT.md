# 当前状态

> **最后确认：** 2026-09-10
> **阶段：** Manifest V3 浏览器扩展，版本 `5.3.3`；核心查询、查看/填入、目录匹配、UniPass 一键登录和 Jupiter 会话保活已接入。

## 当前决策

- 凭据列表先由 Service Worker 检查可用性；空密码账号不展示，Popup 仅在用户点击“查看”或“填入”后接收选中账号的明文密码。
- 填充仅允许 HTTPS 且需匹配应用 origin/path；Content Script 按用户操作临时注入，不自动提交。
- UniPass 离线状态的一键登录由用户点击触发，只在一个标签页、两分钟窗口内操作精确的门户登录页和固定 Tec-IAM 飞书 OAuth 授权页；不读取或保存 Cookie、授权码和飞书页面数据，非预期身份验证由用户处理。
- 本地 manifest 为商店版的下一补丁版，阻止浏览器用商店扩展覆盖；UniPass 网络请求默认发送构建时同步的 `STORE_PLUGIN_VERSION`（当前商店基线 `5.3.2`），每次开发/验证均在线核验。商店版变更时必须同步网络基线，并把本地构建更新为其下一补丁版；用户可临时手动覆盖三段数字请求版号，且不影响发布门禁或本地 `5.3.3`。
- UniPass AES-ECB-PKCS7 解密及 Jupiter 的 MD5/DES-ECB-PKCS7 密码转换已迁入随扩展本地打包的 Rust `credential-core.wasm`；availability 在 WASM 内只返回状态，Jupiter keepalive 从 UniPass ciphertext 直接得到 transformed password，JS 不再接触原始 Jupiter 明文。Service Worker 通过单例本地 loader 按需实例化，WASM ABI 分配、输入/输出与密码学缓冲显式清零。JS 不再包含完整 UniPass 固定材料、CryptoJS 或 Jupiter 固定协议文本。该措施只提高静态分析成本，动态调试仍可能取得运行时材料或明文；TD-004 为外部依赖阻断。
- 最近客观验证：2026-09-10 `npm run verify` 通过（治理检查、静态绿灯审计、58 项 Node/WASM 测试、类型检查、标准压缩构建和最终产物审计）；另行通过 Rust 1.98.1 的 `cargo fmt --check`、`cargo test --locked`、WASM `cargo clippy --locked -- -D warnings` 和 WASM release build。发布包以精确文件白名单阻断源码/source map、调试语句、常见私钥/API token 格式、未审计文件以及 JS/WASM 中的旧密码学特征、完整 key 和固定协议材料，并验证 WASM magic/version、imports/exports。Service Worker 已拆为 116 行的事件/消息入口、276 行的 Jupiter 保活模块和 23 行的用户作用域守卫。真实 Chrome 本轮核心路径仍需按清单复验；既有账户/凭据、页面浮层、一键登录异常分支及 Jupiter 重启、失效、用户切换、关闭托管验收记录保留，TD-002 已归档。目录、凭据与 Jupiter 保活优先以服务端 ID 隔离，缺失时回退到服务端登录名或邮箱；账户页昵称仅在 Popup 内存中作为用户名悬停提示。木星单页应用仅在其已授权同源内允许路由变化。UniPass/Jupiter 请求与 JSON 解析统一为 12 秒超时。
- 私人本地构建以商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 key 固定 ID；每次验证动态查询商店版号，并强制本地与之同主、次版本且补丁号恰高 `1`；每个新商店基线只发布一次对应 GitHub Release。仅允许开发者模式加载，不具备商店发布或签名权。

## 近期优先级

1. 收尾 TD-005 客户端 credential core hardening：完成 WASM ABI、availability/Jupiter 明文暴露、zeroization、产物审计、Rust/Node 测试与 CI 依赖检查实现，并完成真实 Chrome 核心路径复验；TD-004 仅在获得 UniPass 及目标应用后端权限和版本化接口契约后重新评估。

## 按需入口

- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 审查与验证：[docs/AI_RULES.md](docs/AI_RULES.md)
- 活跃技术债：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 长期决策：[docs/ADR/README.md](docs/ADR/README.md)
