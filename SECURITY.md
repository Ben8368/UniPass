# 安全策略与边界

## 保护目标

本扩展处理 UniPass 账号展示信息、短生命周期明文密码和 Jupiter 会话。首要目标是减少凭据暴露、限制可填充页面，并让权限、网络和缓存行为可审计。

## Threat Model / Accepted Risks

### Browser CSV migration

CSV Import is always initiated by a user-selected local file picker. UniPass never scans Downloads, reads the Chromium password database, uses private browser APIs, or deletes browser passwords. Chrome/Edge exports contain plaintext credentials; the parser and preview keep that data in page/Service Worker memory only, never upload it, persist it to `chrome.storage`/IndexedDB, put it in logs or telemetry, or include it in error text. The user is instructed to delete the file and empty the recycle bin/trash. JavaScript cannot guarantee immediate physical erasure from storage media.

### 主要保护目标

- 恶意网页不能直接取得扩展保存的凭据；错误页面或错误账号不能绕过 HTTPS、origin/path 和用户触发检查完成填充。
- WebDAV 服务端即使泄露，也只能看到加密 Vault 对象，不能直接得到 Vault plaintext 或 Vault Key。
- local encrypted Vault cache is the primary runtime copy after initial sync; IndexedDB stores only opaque AES-GCM envelopes and sync metadata, never plaintext credentials, WebDAV App Password, or Vault Key.
- Chrome 扩展权限、外部主机和持久化数据保持最小化；凭据不进入日志、明文持久化存储或构建产物。
- Advanced plaintext disclosure 必须由用户显式触发，并且只在当前页面/Popup 的 ephemeral capability 生命周期内存在。

### 不作为主要保护目标

以下情形超出客户端扩展可以可靠提供的安全边界：已完全控制用户 OS、已完全控制并解锁 Chrome Profile、DevTools 或 runtime memory inspection、用户主动安装的恶意修改版扩展。客户端必须持有 Legacy 协议材料，因此 WASM hardening 只提高静态分析成本，不构成真正的秘密边界。

### Accepted Risks / Product Trade-offs

- 备用全局 PIN 有意允许 4–32 位数字。它服务于私人设备上的低摩擦 fallback，不是设备完全失陷后的最终安全边界；本任务不提高最低长度，也不改成强密码要求。
- Legacy UniPass / Jupiter 当前仍是 active requirement。TD-009 只有未来确认不再使用 Legacy 后才执行；当前只冻结无必要的新 Legacy crypto responsibility，不删除现有兼容能力。

## 强制安全不变量

- 真实用户的 UniPass/Vault credential 明文密码不得写入 `localStorage`、`chrome.storage`、日志、错误文本、测试 fixture 或构建产物；仅允许不对应任何真实账号的固定算法测试向量。WebDAV App Password 和 Vault Key 是另行管理的认证 secret，只能以扩展设备密钥保护的密文长期保存，解密后的值仅在 Service Worker 当前运行需要时存在。
- Normal Mode 可完整展示 username/email/phone/account name、备注和账号选择，并允许 Fill；Normal Mode 的明文 password 只在 Service Worker 到 Content Script 的 Fill 短路径中存在，不返回 Popup/页面浮层 UI。
- Advanced Mode 是 ephemeral plaintext disclosure capability：只有当前 Popup/页面浮层完成显式握手并保持 `unipass-advanced-mode` Port 时，`revealCredential` 才能由 Service Worker 返回选中账号的 `{ username, password }`；Credential panel、Reveal 和 Copy Password 只属于该路径。
- Advanced capability 绑定 `sender.documentId` 与 Port，Port disconnect、Popup `pagehide`、页面浮层移除或 Service Worker 重启都会 revoke；不写入 `localStorage`、`chrome.storage.local` 或 `chrome.storage.session`，也不使用 TTL/alarm 做 capability 持久化。
- 填充只允许 HTTPS 且与应用 URL 的 origin/path 匹配；执行前重新检查标签页仍活动且未导航到其他应用。
- 木星是 manifest 明确允许的单页应用；其登录前后路由可变，但仅限 `https://jupiter.tec-do.com` 同一 origin 内匹配，其他应用仍按 origin/path 严格校验。
- Content Script 只按用户操作临时注入，只写标准可见输入框，不自动提交表单；扩展 Action 点击后可在当前 HTTPS 页面临时挂载 Shadow DOM 浮层，点击页面外部、按 Escape、再次点击扩展或页面离开后不保留。
- UniPass 一键登录只在用户点击离线状态按钮后启动；后台只跟踪一个登录标签页且最多两分钟。登录中的 Popup/页面浮层只在自身存活期间每秒确认 `/session/current_user`，成功后刷新自身展示，并仅关闭本次由扩展创建的后台登录标签；复用用户已有登录标签时绝不关闭。关闭浮层或窗口到期即停止检测；不写入新增敏感持久化状态。登录状态写入后可立即尝试注入，但页面内点击脚本仅接受精确的 UniPass 登录页，以及 `accounts.feishu.cn` 上固定 Tec-IAM `client_id`、固定 `redirect_uri`、非空 `state`、固定应用/权限文案和唯一可见“授权”按钮；不读取或持久化 Cookie、授权码和飞书页面数据。
- Jupiter token 只保存在 `chrome.storage.session` 和目标站点自身 session/local storage；保活续期只静默更新已有页面会话，不派发鉴权事件、不刷新页面；关闭托管时清除扩展会话副本。
- API、解密或目录同步失败必须显式失败；未知错误不得被缓存成“空密码”，部分目录不得覆盖上次完整目录。
- Cache writes are local-first and marked `dirty`; successful conditional WebDAV upload becomes `clean`, while ETag conflict becomes `conflict`. Sync never applies silent last-write-wins.
- UniPass 账户页昵称来自 `/api/v1/session/current_user` 的 `nickName`；按用户明确请求，Service Worker 可将其传入 Popup 内存作为用户名的悬停提示。昵称不得持久化、写日志、参与身份作用域或用于其他页面。
- 用户作用域优先使用服务端稳定 ID（`id`、`userId` 或 `user_id`）；缺失时只可回退服务端登录名 `username`，再回退邮箱 `email`。显示名、昵称和默认值绝不作为身份键。三者均缺失时不执行 UniPass 目录、应用或凭据请求，Jupiter 保活不可开启；已启用保活在检测到用户切换后会停止并清除扩展会话 token。
- UniPass 与 Jupiter 请求统一使用 12 秒超时；超时只返回通用错误，不包含密码或 token。网络版号优先取经校验的 `chrome.storage.local` 手动 override，否则只读取本地 `runtime-config.json`，不使用本地 manifest 版本作为网络版号。
- UniPass AES-ECB-PKCS7 解密与 Jupiter 的 MD5/DES-ECB-PKCS7 密码转换位于随扩展本地打包的 `credential-core.wasm`。Service Worker 通过 `chrome.runtime.getURL` 只加载一次本地核心，重启后按需重建；不下载或执行远程代码。WASM 的输入、密钥材料、轮密钥、摘要、plaintext 和临时输出在完成后显式清零；ABI allocation registry 区分 `Input`/`Output`、最多保留 64 个 live allocation，只有匹配登记的 pointer/length 才能释放，crypto input 只能使用 `Input`。非法 pointer/length、double free 和上限耗尽均 fail closed。`c_v` 只返回状态，`c_k` 只返回 Jupiter 请求所需的 transformed password；只有 Reveal/Fill 的既有功能才把原始明文交给 JS。
- `Jupiter transformedPassword` 是 credential-equivalent secret：虽然它不是原始密码，但同样不得写入 `localStorage`、`chrome.storage.local`、日志、缓存、telemetry 或错误文本。它只在一次用户主动开启的 Jupiter 保活请求中存在于 Service Worker 的局部变量、请求 body 和短暂消息对象中；请求结束或异常时必须在 `finally` 中清空 username 与 transformed password 引用，且不得保存历史或返回给 Popup/页面。Jupiter 登录响应中的 `userInfo` 在写入会话前递归剔除 password、token、secret、authorization、cookie、credential、code、access、refresh、JWT 和 session 等敏感字段，并限制嵌套深度与集合大小。
- Reveal/Fill 的明文仍是既有产品能力，不因 hardening 删除，但两条数据流严格分开：`fillFromPopup`/`fillFromOverlay` 只携带 `accountId`，由 Service Worker 获取并填入；`revealCredential` 先检查 Advanced capability，再把选中凭据交给当前 Advanced UI。Content Script 填充完成后立即清空消息中的 username/password 字段；页面离开、Popup 关闭、浮层移除、账号切换、再次 Reveal 和 60 秒 TTL 到期均清除 UI 内存字段。
- 发布构建使用标准 minification 且不生成 sourcemap；最小 CSP 增加 `wasm-unsafe-eval` 以实例化本地 WASM。普通 `verify` 与 hardened `verify:hardened` 都是正式门禁；hardened 默认要求固定版本 Binaryen `wasm-opt`，只有显式 `UNIPASS_ALLOW_UNOPTIMIZED_WASM=1` 才允许调试降级。最终 `dist/` 审计只接受运行文件，构建报告与 `integrity.json` 位于 `artifacts/hardened/`，并验证 WASM magic/version、可实例化性、imports/exports 白名单、完整 raw AES key、Base64/hex key、Jupiter 固定协议文本和项目 `src/*.rs` path 不出现在运行产物中。WASM 与材料重构只提高静态分析成本；客户端仍必须持有协议材料，不能作为对终端用户保密的安全边界，这是当前接受的产品边界。

- Self Derived Build 是 Popup 内的静态打包器：只按当前构建生成的 `self-build-files.json` fetch runtime 文件；清单不存在或文件超出单文件/总量限制时 fail closed。禁止读取 `chrome.storage`、`localStorage`、cookies、凭据、token、会话或用户输入数据（目标版号除外）。生成前后均 fail closed 审计 manifest 版本/key、除 `version`/`version_name` 外的顶层字段、WASM magic、runtime config、完整文件集合和 WASM byte-for-byte 一致性；不申请 `downloads` 权限，使用用户点击触发的 Blob 下载。它不会重新编译 Rust/WASM、生成新的 hardened crypto strategy 或 AES material fragmentation。

WebDAV Vault 是独立于 Legacy UniPass 的新数据源。齿轮二级页只接受 HTTPS URL，并在用户主动测试/保存时由同一个 Service Worker 操作通过 `chrome.permissions.request` 申请对应的 `https://host/*` optional origin；manifest 不包含 WebDAV 永久 host permission。测试完成、保存失败、endpoint 迁移或删除 Profile 后，Service Worker 会回收未被其他 Profile 使用的 origin。Popup/页面浮层只在用户点击测试或保存时短暂发送用户名、App Password 和 Vault Key，绝不自行发起 WebDAV 网络请求；网络请求和 `Authorization` header 始终由 Service Worker 的 `WebDavBackend` 生成。当前页就地添加账号同样只能由用户提交触发，且自动建立的目标仅为当前 HTTPS 域名。Legacy userScope 只保护 legacy-unipass；WebDAV 使用自身 AccountRef、持久化加密连接材料/Vault Key 与 Advanced capability。扩展在 IndexedDB 中保存不可导出的设备 AES-256-GCM 密钥，在 `chrome.storage.local` 保存按 Vault 加密的连接材料密文；浏览器重启后自动恢复 WebDAV 登录态，不要求 PIN。查看账号密码和 Legacy 高级功能优先使用系统 WebAuthn 用户验证：扩展校验一次性 challenge、`webauthn.create/get`、扩展 origin、`authenticatorData` 的 `rpIdHash = SHA-256(chrome-extension://<extension-id>)`、用户已验证标志、本地公钥签名和 credential ID；替换已有验证器前必须再次通过当前系统验证器或备用 PIN。扩展不接触 macOS/Windows 的具体 PIN；系统验证不可用时才回退到 4 至 32 位备用全局 PIN。备用 PIN 明文不保存，失败计数只在 session，达到上限 fail closed。解密后的认证用户名、App Password 和 Vault Key 只在 Service Worker 当前运行需要时进入内存或 `chrome.storage.session`，不写入明文 local、localStorage、Vault Object 或日志。Vault Key 绝不上传 WebDAV。新建 Vault 时仅向当前设置界面返回一次恢复用 Vault Key，用户必须自行安全保存；界面关闭后清空显示值。重新连接已有 Vault 时优先使用本机长期保存的连接材料，用户也可填写新材料替换；缺失或错误时不得生成新 Key、覆盖 profile 或写入远端数据。用户在确认后可删除本地 Vault Profile；该操作只清除扩展中的 Profile、持久化/会话连接材料和不再使用的 optional host permission，绝不删除 WebDAV 服务器上的对象。

- 当前页只能将本会话已连接的 Vault 作为写入目标；未连接 Profile 仅公开 ID、名称和连接状态，界面必须引导用户重新连接，不能将读取失败降级为“没有保存账号”。

Vault Core 使用 AES-256-GCM、每对象随机 12-byte nonce、`formatVersion: 1` 与 `keyVersion: 1`。WebDAV 只保存加密后的 App/Account/Credential/Manifest objects；目录 `PROPFIND` 只读取 App/Account 对象，Credential object 仅在 Fill/Reveal/可用性检查时按需读取。对象更新以 WebDAV ETag 映射为 opaque `RevisionToken`，使用 `If-Match`；新建使用 `If-None-Match: *`，409/412 映射为结构化 conflict，禁止 silent last-write-wins。删除在 Core 中保留 `deletedAt` tombstone 并加密更新对象，给未来 D1/GitHub 同步保留扩展点。

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
- 页面浮层使用 closed Shadow DOM 隔离页面样式和 DOM；其目录缓存与主题设置仅保存在浮层页面内存中，浮层移除后清除。浮层不读取页面正文、Cookie、localStorage 或表单值；打开时仅读取根节点/正文及视口采样点的渲染背景色与 color-scheme，仅用于自动选择明暗主题。Normal 浮层可 Fill 但不能 Reveal；Advanced 浮层的 capability 独立绑定当前页面 document，移除时撤销。
- Advanced Mode 是客户端内的误操作防护和能力分层，不是针对控制本机、DevTools、调试 Service Worker 或修改扩展代码攻击者的认证边界；真实 UniPass/飞书 OAuth/Jupiter 行为依赖外部服务和登录状态，自动化测试不能替代按场景执行的手动集成验收。
- 发布工程同时要求 Cargo.lock 的 RustSec gate、固定 Rust 1.98.1 的两次独立 WASM 构建一致、完整 SHA pin 的 GitHub Actions、Dependabot，以及 [Chrome 验收清单](docs/CHROME-ACCEPTANCE.md) 中的自动化 smoke；人工登录清单仍需单独执行。
- 飞书若显示账号选择、扫码、验证码、CAPTCHA、权限变化或其他非预期页面，一键登录会停止，由用户手动处理。

## 安全变更检查

涉及凭据、权限、外部请求、存储、URL 匹配、Content Script 或 Jupiter 保活时：

1. 阅读 `AGENTS.md`、`CONTEXT.md`、`docs/AI_RULES.md`、`docs/ARCHITECTURE.md` 和本文件。
2. 在验证前输出 `🚦 Audit Report`，红灯修复后再继续。
3. 运行 `npm run verify`，并记录无法自动化的真实浏览器验收。
4. 若长期边界变化，新增或更新 ADR。

发现漏洞时不要在公开 issue 中粘贴凭据、token 或完整响应；使用仓库托管平台的私密安全报告渠道，或先联系维护者提供脱敏复现。
