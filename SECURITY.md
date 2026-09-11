# 安全策略与边界

## 保护目标

本扩展处理 UniPass 账号展示信息、短生命周期明文密码和 Jupiter 会话。首要目标是减少凭据暴露、限制可填充页面，并让权限、网络和缓存行为可审计。

## 强制安全不变量

- 真实用户的明文密码不得写入 `localStorage`、`chrome.storage`、日志、错误文本、测试 fixture 或构建产物；仅允许不对应任何真实账号的固定算法测试向量。
- Popup 列表渲染只接收凭据可用性状态；只有用户点击“查看”或“填入”后才能接收一个选中账号的密码。
- 填充只允许 HTTPS 且与应用 URL 的 origin/path 匹配；执行前重新检查标签页仍活动且未导航到其他应用。
- 木星是 manifest 明确允许的单页应用；其登录前后路由可变，但仅限 `https://jupiter.tec-do.com` 同一 origin 内匹配，其他应用仍按 origin/path 严格校验。
- Content Script 只按用户操作临时注入，只写标准可见输入框，不自动提交表单；扩展 Action 点击后可在当前 HTTPS 页面临时挂载 Shadow DOM 浮层，点击页面外部、按 Escape、再次点击扩展或页面离开后不保留。
- UniPass 一键登录只在用户点击离线状态按钮后启动；后台只跟踪一个登录标签页且最多两分钟。登录中的 Popup/页面浮层只在自身存活期间每秒确认 `/session/current_user`，成功后刷新自身展示，并仅关闭本次由扩展创建的后台登录标签；复用用户已有登录标签时绝不关闭。关闭浮层或窗口到期即停止检测；不写入新增敏感持久化状态。登录状态写入后可立即尝试注入，但页面内点击脚本仅接受精确的 UniPass 登录页，以及 `accounts.feishu.cn` 上固定 Tec-IAM `client_id`、固定 `redirect_uri`、非空 `state`、固定应用/权限文案和唯一可见“授权”按钮；不读取或持久化 Cookie、授权码和飞书页面数据。
- Jupiter token 只保存在 `chrome.storage.session` 和目标站点自身 session/local storage；保活续期只静默更新已有页面会话，不派发鉴权事件、不刷新页面；关闭托管时清除扩展会话副本。
- API、解密或目录同步失败必须显式失败；未知错误不得被缓存成“空密码”，部分目录不得覆盖上次完整目录。
- UniPass 账户页昵称来自 `/api/v1/session/current_user` 的 `nickName`；按用户明确请求，Service Worker 可将其传入 Popup 内存作为用户名的悬停提示。昵称不得持久化、写日志、参与身份作用域或用于其他页面。
- 用户作用域优先使用服务端稳定 ID（`id`、`userId` 或 `user_id`）；缺失时只可回退服务端登录名 `username`，再回退邮箱 `email`。显示名、昵称和默认值绝不作为身份键。三者均缺失时不执行 UniPass 目录、应用或凭据请求，Jupiter 保活不可开启；已启用保活在检测到用户切换后会停止并清除扩展会话 token。
- UniPass 与 Jupiter 请求统一使用 12 秒超时；超时只返回通用错误，不包含密码或 token。网络版号优先取经校验的 `chrome.storage.local` 手动 override，否则只读取本地 `runtime-config.json`，不使用本地 manifest 版本作为网络版号。
- UniPass AES-ECB-PKCS7 解密与 Jupiter 的 MD5/DES-ECB-PKCS7 密码转换位于随扩展本地打包的 `credential-core.wasm`。Service Worker 通过 `chrome.runtime.getURL` 只加载一次本地核心，重启后按需重建；不下载或执行远程代码。WASM 的输入、密钥材料、轮密钥、摘要、plaintext 和临时输出在完成后显式清零；ABI allocation registry 区分 `Input`/`Output`、最多保留 64 个 live allocation，只有匹配登记的 pointer/length 才能释放，crypto input 只能使用 `Input`。非法 pointer/length、double free 和上限耗尽均 fail closed。`c_v` 只返回状态，`c_k` 只返回 Jupiter 请求所需的 transformed password；只有 Reveal/Fill 的既有功能才把原始明文交给 JS。
- `Jupiter transformedPassword` 是 credential-equivalent secret：虽然它不是原始密码，但同样不得写入 `localStorage`、`chrome.storage.local`、日志、缓存、telemetry 或错误文本。它只在一次用户主动开启的 Jupiter 保活请求中存在于 Service Worker 的局部变量、请求 body 和短暂消息对象中；请求结束或异常时必须在 `finally` 中清空 username 与 transformed password 引用，且不得保存历史或返回给 Popup/页面。
- Reveal/Fill 的明文仍是既有产品能力，不因 hardening 删除；Service Worker、Popup 消息和 Content Script 只保留完成当前操作所需的最小引用。Content Script 填充完成后立即清空消息中的 username/password 字段；页面离开、Popup 关闭、账号切换、再次 Reveal 和 60 秒 TTL 到期均清除 Popup 内存字段。
- 发布构建使用标准 minification 且不生成 sourcemap；最小 CSP 增加 `wasm-unsafe-eval` 以实例化本地 WASM。普通 `verify` 与 hardened `verify:hardened` 都是正式门禁；hardened 默认要求固定版本 Binaryen `wasm-opt`，只有显式 `UNIPASS_ALLOW_UNOPTIMIZED_WASM=1` 才允许调试降级。最终 `dist/` 审计只接受运行文件，构建报告与 `integrity.json` 位于 `artifacts/hardened/`，并验证 WASM magic/version、可实例化性、imports/exports 白名单、完整 raw AES key、Base64/hex key、Jupiter 固定协议文本和项目 `src/*.rs` path 不出现在运行产物中。WASM 与材料重构只提高静态分析成本；客户端仍必须持有协议材料，不能作为对终端用户保密的安全边界，TD-004 仅在外部后端权限与接口契约可用时重新评估。

- Self Derived Build 是 Popup 内的静态打包器：只按构建生成的 `self-build-files.json` fetch 当前 runtime 文件，禁止读取 `chrome.storage`、`localStorage`、cookies、凭据、token、会话或用户输入数据（目标版号除外）。生成前后均 fail closed 审计 manifest 版本/key、WASM magic、runtime config、完整文件集合和 WASM byte-for-byte 一致性；不申请 `downloads` 权限，使用用户点击触发的 Blob 下载。它不会重新编译 Rust/WASM、生成新的 hardened crypto strategy 或 AES material fragmentation。

## 权限与主机

权限和 host permissions 以 `public/manifest.json` 为唯一运行事实：

- `activeTab`、`scripting`：用户点击扩展 Action 后读取当前 HTTPS 页面并临时注入 Shadow DOM 浮层，浮层内用户触发的当前页填充，以及用户明确点击“一键登录”后的两个受限登录按钮。浮层不在 HTTP、浏览器内部页或不具备当前页授权的上下文注入。
- `clipboardWrite`：用户点击复制。
- `storage`：非明文设置、TTL 状态、会话数据，以及用户手动指定的三段数字网络版号。
- `alarms`：用户主动开启的 Jupiter 定时保活。
- `tabs`：识别当前页面、管理用户触发的一键登录标签页，以及同步已打开的 Jupiter 标签页。
- `https://accounts.feishu.cn/*` 仅用于用户触发的一键登录，在校验固定 Tec-IAM OAuth 客户端、回调地址和授权范围后点击唯一授权按钮；扩展不向飞书发起后台请求。
- UniPass、上述飞书授权页与 Jupiter 是当前仅允许的扩展运行时外部主机；Chrome 官方更新接口只由本地 Node 审计脚本访问，不属于扩展运行时权限。
- 页面浮层只向 HTTPS 页面公开扩展内置的三个品牌图标资源，用于 Shadow DOM 内的 Logo 展示；不公开脚本、样式、WASM、凭据或其他运行资源。`credential-core.wasm` 仅由扩展 Service Worker 的本地 URL 加载。
- 私人本地构建的 manifest `key` 固定为商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 ID；该值不是私钥，不授予商店发布或 CRX 签名权限。因同一 ID 可能与商店版争用 Profile 状态，必须在独立 Profile 完成人工安装验收。
- 默认 UniPass 请求的 `X-Browser-Plugin-Version` 使用当前构建的 `runtime-config.json` 网络基线，绝不使用本地 `chrome.runtime.getManifest().version`。用户可手动设置经过三段数字校验的覆盖值；它只存为非敏感配置并只影响该请求头，清空后恢复基线。该覆盖不改变本地替身版与商店基线高一个补丁号的发布约束；开发/验证仍在线核验并随商店版更新这对值，扩展运行时不查询商店。Self Derived Build 不受实时商店查询阻断，其网络版号只由目标本地版号的同主次 `patch - 1` 推导。

新增权限或域名前必须说明最小必要范围、数据内容、触发条件、失败/关闭路径，并更新本文件、README 和红绿灯报告。

## 已知边界

- 浏览器扩展无法阻止目标 HTTPS 页面自身脚本读取已填入的输入框；因此必须依赖应用 URL 匹配和用户明确操作。
- 系统剪贴板不会自动清空，避免覆盖用户后来复制的内容。
- 跨域 iframe、关闭的 Shadow DOM、Canvas 和非标准登录控件不在通用填充承诺内。
- 页面浮层使用 closed Shadow DOM 隔离页面样式和 DOM；其目录缓存与主题设置仅保存在浮层页面内存中，浮层移除后清除。浮层不读取页面正文、Cookie、localStorage 或表单值；打开时仅读取渲染背景色与 `color-scheme` 用于自动选择明暗主题；凭据仍只在后台消息和用户点击后的目标输入框中短暂存在。
- 真实 UniPass/飞书 OAuth/Jupiter 行为依赖外部服务和登录状态，自动化测试不能替代按场景执行的手动集成验收。
- 发布工程同时要求 Cargo.lock 的 RustSec gate、固定 Rust 1.98.1 的两次独立 WASM 构建一致、完整 SHA pin 的 GitHub Actions、Dependabot，以及 [Chrome 验收清单](docs/CHROME-ACCEPTANCE.md) 中的自动化 smoke；人工登录清单仍需单独执行。
- 飞书若显示账号选择、扫码、验证码、CAPTCHA、权限变化或其他非预期页面，一键登录会停止，由用户手动处理。

## 安全变更检查

涉及凭据、权限、外部请求、存储、URL 匹配、Content Script 或 Jupiter 保活时：

1. 阅读 `AGENTS.md`、`CONTEXT.md`、`docs/AI_RULES.md`、`docs/ARCHITECTURE.md` 和本文件。
2. 在验证前输出 `🚦 Audit Report`，红灯修复后再继续。
3. 运行 `npm run verify`，并记录无法自动化的真实浏览器验收。
4. 若长期边界变化，新增或更新 ADR。

发现漏洞时不要在公开 issue 中粘贴凭据、token 或完整响应；使用仓库托管平台的私密安全报告渠道，或先联系维护者提供脱敏复现。
