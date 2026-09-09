# 安全策略与边界

## 保护目标

本扩展处理 UniPass 账号展示信息、短生命周期明文密码和 Jupiter 会话。首要目标是减少凭据暴露、限制可填充页面，并让权限、网络和缓存行为可审计。

## 强制安全不变量

- 明文密码不得写入 `localStorage`、`chrome.storage`、日志、错误文本、测试 fixture 或构建产物。
- Popup 列表渲染只接收凭据可用性状态；只有用户点击“查看”或“填入”后才能接收一个选中账号的密码。
- 填充只允许 HTTPS 且与应用 URL 的 origin/path 匹配；执行前重新检查标签页仍活动且未导航到其他应用。
- 木星是 manifest 明确允许的单页应用；其登录前后路由可变，但仅限 `https://jupiter.tec-do.com` 同一 origin 内匹配，其他应用仍按 origin/path 严格校验。
- Content Script 只按用户操作临时注入，只写标准可见输入框，不自动提交表单；扩展 Action 点击后可在当前 HTTPS 页面临时挂载 Shadow DOM 浮层，点击页面外部、按 Escape、再次点击扩展或页面离开后不保留。
- UniPass 一键登录只在用户点击离线状态按钮后启动；后台只跟踪一个登录标签页且最多两分钟。登录状态写入后可立即尝试注入，但页面内点击脚本仅接受精确的 UniPass 登录页，以及 `accounts.feishu.cn` 上固定 Tec-IAM `client_id`、固定 `redirect_uri`、非空 `state`、固定应用/权限文案和唯一可见“授权”按钮；不读取或持久化 Cookie、授权码和飞书页面数据。
- Jupiter token 只保存在 `chrome.storage.session` 和目标站点自身 session/local storage；保活续期只静默更新已有页面会话，不派发鉴权事件、不刷新页面；关闭托管时清除扩展会话副本。
- API、解密或目录同步失败必须显式失败；未知错误不得被缓存成“空密码”，部分目录不得覆盖上次完整目录。
- UniPass 账户页昵称来自 `/api/v1/session/current_user` 的 `nickName`；按用户明确请求，Service Worker 可将其传入 Popup 内存作为用户名的悬停提示。昵称不得持久化、写日志、参与身份作用域或用于其他页面。
- 用户作用域优先使用服务端稳定 ID（`id`、`userId` 或 `user_id`）；缺失时只可回退服务端登录名 `username`，再回退邮箱 `email`。显示名、昵称和默认值绝不作为身份键。三者均缺失时不执行 UniPass 目录、应用或凭据请求，Jupiter 保活不可开启；已启用保活在检测到用户切换后会停止并清除扩展会话 token。
- UniPass 与 Jupiter 请求统一使用 12 秒超时；超时只返回通用错误，不包含密码或 token。

## 权限与主机

权限和 host permissions 以 `public/manifest.json` 为唯一运行事实：

- `activeTab`、`scripting`：用户点击扩展 Action 后读取当前 HTTPS 页面并临时注入 Shadow DOM 浮层，浮层内用户触发的当前页填充，以及用户明确点击“一键登录”后的两个受限登录按钮。HTTP、浏览器内部页或不具备当前页授权的上下文只打开扩展自身 Popup，绝不注入页面脚本。
- `clipboardWrite`：用户点击复制。
- `storage`：非明文设置、TTL 状态、会话数据，以及用户手动指定的三段数字网络版号。
- `alarms`：用户主动开启的 Jupiter 定时保活。
- `tabs`：识别当前页面、管理用户触发的一键登录标签页，以及同步已打开的 Jupiter 标签页。
- `https://accounts.feishu.cn/*` 仅用于用户触发的一键登录，在校验固定 Tec-IAM OAuth 客户端、回调地址和授权范围后点击唯一授权按钮；扩展不向飞书发起后台请求。
- UniPass、上述飞书授权页与 Jupiter 是当前仅允许的扩展运行时外部主机；Chrome 官方更新接口只由本地 Node 审计脚本访问，不属于扩展运行时权限。
- 页面浮层只向 HTTPS 页面公开扩展内置的三个品牌图标资源，用于 Shadow DOM 内的 Logo 展示；不公开脚本、样式、凭据或其他运行资源。
- 私人本地构建的 manifest `key` 固定为商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 ID；该值不是私钥，不授予商店发布或 CRX 签名权限。因同一 ID 可能与商店版争用 Profile 状态，必须在独立 Profile 完成人工安装验收。
- 默认 UniPass 请求的 `X-Browser-Plugin-Version` 使用当前构建嵌入的 `STORE_PLUGIN_VERSION`（商店基线），绝不使用本地 `chrome.runtime.getManifest().version`。用户可手动设置经过三段数字校验的覆盖值；它只存为非敏感配置并只影响该请求头，清空后恢复基线。该覆盖不改变本地替身版与商店基线高一个补丁号的发布约束；开发/验证仍在线核验并随商店版更新这对值，扩展运行时不查询商店。

新增权限或域名前必须说明最小必要范围、数据内容、触发条件、失败/关闭路径，并更新本文件、README 和红绿灯报告。

## 已知边界

- 浏览器扩展无法阻止目标 HTTPS 页面自身脚本读取已填入的输入框；因此必须依赖应用 URL 匹配和用户明确操作。
- 系统剪贴板不会自动清空，避免覆盖用户后来复制的内容。
- 跨域 iframe、关闭的 Shadow DOM、Canvas 和非标准登录控件不在通用填充承诺内。
- 页面浮层使用 closed Shadow DOM 隔离页面样式和 DOM；其目录缓存与主题设置仅保存在浮层页面内存中，浮层移除后清除。浮层不读取页面正文、Cookie、localStorage 或表单值；打开时仅读取渲染背景色与 `color-scheme` 用于自动选择明暗主题；凭据仍只在后台消息和用户点击后的目标输入框中短暂存在。
- 真实 UniPass/飞书 OAuth/Jupiter 行为依赖外部服务和登录状态，自动化测试不能替代按场景执行的手动集成验收。
- 飞书若显示账号选择、扫码、验证码、CAPTCHA、权限变化或其他非预期页面，一键登录会停止，由用户手动处理。

## 安全变更检查

涉及凭据、权限、外部请求、存储、URL 匹配、Content Script 或 Jupiter 保活时：

1. 阅读 `AGENTS.md`、`CONTEXT.md`、`docs/AI_RULES.md`、`docs/ARCHITECTURE.md` 和本文件。
2. 在验证前输出 `🚦 Audit Report`，红灯修复后再继续。
3. 运行 `npm run verify`，并记录无法自动化的真实浏览器验收。
4. 若长期边界变化，新增或更新 ADR。

发现漏洞时不要在公开 issue 中粘贴凭据、token 或完整响应；使用仓库托管平台的私密安全报告渠道，或先联系维护者提供脱敏复现。
