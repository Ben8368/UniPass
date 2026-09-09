# UniPass Minimal

这是对原 UniPass 扩展的最小权限 TypeScript 重构。
本项目仅供私人本地开发使用。构建 manifest 固定为商店插件 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 ID。每次 `npm run verify` 都会从 Chrome 官方更新接口查询当前商店版号，并要求本地 `package.json`/manifest 保持同一主、次版本且补丁号恰高 `1`；因此商店升级后必须先同步本地版号再构建。它在同一 Chrome Profile 中不能与商店版同时启用；仅通过开发者模式加载 `dist`，不用于 Chrome Web Store 或其他公开分发。公开 key 只能固定 ID，不能提供商店发布或 CRX 签名权限。


## 下载与安装

每个正式版本都可从 [GitHub Releases](https://github.com/Ben8368/UniPass/releases) 直接下载 `UniPass-v*.zip`：

1. 下载并解压 ZIP 文件到一个固定目录；
2. 打开 `chrome://extensions`，开启右上角的**开发者模式**；
3. 点击**加载已解压的扩展程序**，选择解压后的目录（其中应直接包含 `manifest.json`）。

同一 Release 中的 `.sha256` 文件可用于校验 ZIP 下载完整性。仅在 [替身门禁](docs/AI_RULES.md#5-私人本地替身门禁) 要求的首次跟随发布时推送符合版本号的 Git 标签（例如 `v0.1.0`）；GitHub Actions 会自动构建扩展、生成 ZIP 和校验文件，并创建 GitHub Release。
商店基线未变化时，后续 `main` 改动不会重复创建同版本 Release；因此 Release 是该商店基线的首次跟随快照，不代表当前 `main`。需要当前源码时应本地构建，或使用对应 CI run 的未压缩构建产物。

## 权限边界

- `activeTab`：仅在用户点击扩展后读取当前标签页地址，并在当前 HTTPS 页面挂载本次页面浮层和授权本次填充。
- `scripting`：在用户点击扩展后临时注入页面浮层，点击“填入”后注入固定填充脚本；用户点击“一键登录”后，只在固定 UniPass/Tec-IAM 登录流程中点击两个精确匹配的按钮。
- `clipboardWrite`：仅响应用户点击，将用户选择的账号或密码写入系统剪贴板。
- `storage`：保存短期凭据可用性状态、用户主动开启的 Jupiter 保活配置和结果，以及一键登录的临时标签页状态；密码不会写入持久化存储。
- `alarms`：仅用于用户主动开启后的木星会话定时保活；续期在后台重复提交登录请求，不刷新已打开的木星页面。
- `tabs`：识别当前页面、管理用户触发的一键登录标签页，并把新获取的木星会话同步到已打开的木星标签页。
- `https://portal.unipass.top/*`：调用 UniPass API，并使用浏览器已有的 UniPass 登录会话。
- `https://accounts.feishu.cn/*`：仅在用户点击“一键登录”后，对固定 Tec-IAM OAuth 客户端和回调地址点击“授权”；不读取飞书账号数据或授权码。
- `https://jupiter.tec-do.com/*`：仅在用户主动开启木星保活后登录并同步会话。

扩展不申请 `cookies`、`privacy`、`webNavigation`、`contextMenus`、`declarativeNetRequest` 或 `<all_urls>`，也不注册常驻 Content Script。

## 本地构建与加载

```powershell
npm install
npm run verify
```

打开 `chrome://extensions`，开启开发者模式，然后加载已解压的 `dist` 目录。请先在独立 Chrome Profile 验证；若 Chrome 因同 ID 拒绝加载，需由用户手动停用或移除商店版。不要依赖商店版设置或存储能被自动迁移。

## 项目治理

- [AGENTS.md](AGENTS.md)：AI 协作唯一入口与按需读取路由。
- [CONTEXT.md](CONTEXT.md)：当前决策、最近验证和三项优先级。
- [docs/AI_RULES.md](docs/AI_RULES.md)：`🚦 Audit Report` 红绿灯审查、验证和交付规则。
- [docs/GOVERNANCE.md](docs/GOVERNANCE.md)：单一事实源、篇幅预算和文档自治理。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[SECURITY.md](SECURITY.md)：扩展数据流和凭据/权限边界。
- [CONTRIBUTING.md](CONTRIBUTING.md)：开发、验证与 PR 要求。

`npm run verify` 是本地与 CI 的统一门禁，依次执行治理检查、静态红绿灯、测试、类型检查、标准压缩构建和最终产物审计。产物审计使用精确文件白名单，并阻断源码/source map、调试语句、常见私钥/API token 格式和未审计文件。静态黄灯不会伪装成失败，但必须在人工 `🚦 Audit Report` 中确认并按需登记技术债；红灯会阻断验证。

## 发版流程

1. 每次开发构建前在线核验商店版号；仅在它首次变更时，按[替身门禁](docs/AI_RULES.md#5-私人本地替身门禁)把 `src/shared/plugin-version.ts` 设为该商店版，再将 `package.json` 和 `public/manifest.json` 设为同一个下一补丁版；
2. 提交并推送变更；
3. 创建与版本号完全一致的标签，例如版本 `0.1.0` 对应 `v0.1.0`：

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. 在 [GitHub Actions](https://github.com/Ben8368/UniPass/actions) 等待 **Release extension** 成功；只有通过最终产物审计的 `dist/` 才会生成 ZIP，ZIP 会出现在相应的 [GitHub Release](https://github.com/Ben8368/UniPass/releases) 页面。

`main` 的每次推送和 Pull Request 还会运行 CI：依赖安装、治理与动态版本审计、测试、TypeScript 类型检查、标准压缩构建和最终产物审计，并保留一个可下载的未打包 `dist/` 产物。

## 安全与行为

- 密码只存在于 Service Worker 消息、Popup 内存或用户主动填入的页面字段中。
- 密码不写入 `chrome.storage`、日志或持久化文件。
- 查看凭据 60 秒后自动从 Popup/页面浮层清除，关闭 Popup 或移除页面浮层时立即清除。
- 自动填充只处理当前页面主文档中的可见输入框，不自动提交表单。
- 每次验证通过 Google Chrome 官方更新接口核验 UniPass 商店 CRX 版本；查询失败、ID 不符、本地版本不是商店当前版的下一补丁版，或网络商店基线不等于当前商店版都会阻断。网络基线是每个构建嵌入的商店版本快照，而非永久固定值：例如商店从 `5.3.0` 变为 `5.4.0` 时，必须在同一次开发变更中改为默认网络 `5.4.0`、本地 `5.4.1`。Popup 可在开发中断或未及时跟进时手动指定三段数字网络版号；该临时覆盖不改变构建或发布门禁，清空后恢复商店基线。
- 当前版本不监听 Cookie；若登录状态变化，重新点击扩展打开页面浮层即可刷新。浮层使用 closed Shadow DOM；打开时仅根据当前页面的渲染背景色与 `color-scheme` 自动选择浅色/暗色，不读取页面正文或页面存储；点击页面外部、按 Escape 或再次点击扩展会关闭浮层。
- UniPass 离线时可点击顶部“一键登录”。前台浮层会显示登录中动画与状态；扩展在后台打开或复用登录页，依次点击“钛动科技”和固定 Tec-IAM 飞书授权页的“授权”，并在两分钟内确认 UniPass 会话，成功后自动刷新身份和当前页账号，同时关闭本次由扩展创建的后台登录标签；用户原有登录标签不会被关闭。账号选择、扫码、验证码、CAPTCHA 或授权内容变化时自动流程停止，需用户手动处理。
- 当前版本不自动清空系统剪贴板。最小权限下无法安全确认剪贴板是否已被用户的新内容替换，强制清空可能误删用户内容。
- 当前页面账号通过本地账号目录匹配：首次同步、目录超过 24 小时或用户点击同步按钮时，扩展会从 UniPass 拉取已保存应用的地址和账号展示信息。同步请求只使用服务器返回的应用地址，当前标签页 URL 不会发送到 UniPass，目录中不保存密码。目录缓存优先按服务端稳定用户 ID 隔离；缺失时使用服务端登录名或邮箱，昵称和姓名不参与隔离。三者均缺失时不执行需要用户身份的目录、应用或凭据请求。
- 账号展示前，Service Worker 会按需检查匹配账号是否存在可用密码；空密码账号不会显示。检查结果只保存为 15 分钟会话缓存，Popup 不会在列表渲染时批量接收明文密码。只有用户点击“查看”或“填入”后，选中账号的密码才会发送到 Popup。
- 凭据只允许填入 HTTPS 页面；填入前会再次确认当前标签页仍属于对应应用，避免切换页面后误填。目录、凭据和 Jupiter 保活消息会绑定当前用户作用域；UniPass 与 Jupiter 网络请求 12 秒超时，超时后返回可读错误。

## 已知限制

- 跨域 iframe 内的登录框不会填充。
- 高度定制的 Shadow DOM、Canvas 或非标准登录控件可能需要单独适配。
- 如果 UniPass 的服务端 CORS/Cookie 策略禁止扩展页面直接请求，需要由服务端放行扩展来源，或改为受限的门户页面桥接方案。
