# UniPass Minimal

这是对原 UniPass 扩展的最小权限 TypeScript 重构。它不会修改原始 `extension-source` 目录。

## 下载与安装

每个正式版本都可从 [GitHub Releases](https://github.com/Ben8368/UniPass/releases) 直接下载 `UniPass-v*.zip`：

1. 下载并解压 ZIP 文件到一个固定目录；
2. 打开 `chrome://extensions`，开启右上角的**开发者模式**；
3. 点击**加载已解压的扩展程序**，选择解压后的目录（其中应直接包含 `manifest.json`）。

同一 Release 中的 `.sha256` 文件可用于校验 ZIP 下载完整性。每次推送符合版本号的 Git 标签（例如 `v0.1.0`）后，GitHub Actions 会自动构建扩展、生成 ZIP 和校验文件，并创建 GitHub Release。

## 权限边界

- `activeTab`：仅在用户点击扩展后读取当前标签页地址，并授权本次填充。
- `scripting`：仅在用户点击“填入”后向当前标签页注入固定的填充脚本。
- `clipboardWrite`：仅响应用户点击，将用户选择的账号或密码写入系统剪贴板。
- `storage`：保存插件版本设置、短期凭据可用性状态，以及用户主动开启的木星保活设置；密码不会写入持久化存储。
- `alarms`：仅用于用户主动开启后的木星会话定时保活。
- `tabs`：识别当前页面，并把新获取的木星会话同步到已打开的木星标签页。
- `https://portal.unipass.top/*`：调用 UniPass API，并使用浏览器已有的 UniPass 登录会话。
- `https://clients2.google.com/*`、`https://clients2.googleusercontent.com/*`：从 Chrome 官方更新接口解析 UniPass 商店插件版本。
- `https://jupiter.tec-do.com/*`：仅在用户主动开启木星保活后登录并同步会话。

扩展不申请 `cookies`、`privacy`、`webNavigation`、`contextMenus`、`declarativeNetRequest` 或 `<all_urls>`，也不注册常驻 Content Script。

## 本地构建与加载

```powershell
npm install
npm run verify
```

打开 `chrome://extensions`，开启开发者模式，然后加载已解压的 `dist` 目录。

## 项目治理

- [AGENTS.md](AGENTS.md)：AI 协作唯一入口与按需读取路由。
- [CONTEXT.md](CONTEXT.md)：当前决策、最近验证和三项优先级。
- [docs/AI_RULES.md](docs/AI_RULES.md)：`🚦 Audit Report` 红绿灯审查、验证和交付规则。
- [docs/GOVERNANCE.md](docs/GOVERNANCE.md)：单一事实源、篇幅预算和文档自治理。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[SECURITY.md](SECURITY.md)：扩展数据流和凭据/权限边界。
- [CONTRIBUTING.md](CONTRIBUTING.md)：开发、验证与 PR 要求。

`npm run verify` 是本地与 CI 的统一门禁，依次执行治理检查、静态红绿灯、测试、类型检查和构建。静态黄灯不会伪装成失败，但必须在人工 `🚦 Audit Report` 中确认并按需登记技术债；红灯会阻断验证。

## 发版流程

1. 在 `package.json` 和 `public/manifest.json` 中设置相同的版本号；
2. 提交并推送变更；
3. 创建与版本号完全一致的标签，例如版本 `0.1.0` 对应 `v0.1.0`：

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. 在 [GitHub Actions](https://github.com/Ben8368/UniPass/actions) 等待 **Release extension** 成功；ZIP 会出现在相应的 [GitHub Release](https://github.com/Ben8368/UniPass/releases) 页面。

`main` 的每次推送和 Pull Request 还会运行 CI：依赖安装、TypeScript 类型检查、构建，并保留一个可下载的未压缩构建产物。

## 安全与行为

- 密码只存在于 Service Worker 消息、Popup 内存或用户主动填入的页面字段中。
- 密码不写入 `chrome.storage`、日志或持久化文件。
- 查看凭据 60 秒后自动从 Popup 清除，关闭 Popup 时立即清除。
- 自动填充只处理当前页面主文档中的可见输入框，不自动提交表单。
- 扩展通过 Google Chrome 官方更新接口查询 UniPass 的最新 CRX 版本，并缓存成功结果 6 小时；网络失败时回退到 `5.3.0` 并缓存 15 分钟，避免每个门户 API 请求都重复访问更新接口。点击 Popup 右上角齿轮可手动指定版本，清空并保存即可恢复自动获取。
- 当前版本不监听 Cookie；若登录状态变化，重新打开 Popup 即可刷新。
- 当前版本不自动清空系统剪贴板。最小权限下无法安全确认剪贴板是否已被用户的新内容替换，强制清空可能误删用户内容。
- 当前页面账号通过本地账号目录匹配：首次同步、目录超过 24 小时或用户点击同步按钮时，扩展会从 UniPass 拉取已保存应用的地址和账号展示信息。同步请求只使用服务器返回的应用地址，当前标签页 URL 不会发送到 UniPass，目录中不保存密码。
- 账号展示前，Service Worker 会按需检查匹配账号是否存在可用密码；空密码账号不会显示。检查结果只保存为 15 分钟会话缓存，Popup 不会在列表渲染时批量接收明文密码。只有用户点击“查看”或“填入”后，选中账号的密码才会发送到 Popup。
- 凭据只允许填入 HTTPS 页面；填入前会再次确认当前标签页仍属于对应应用，避免切换页面后误填。

## 已知限制

- 跨域 iframe 内的登录框不会填充。
- 高度定制的 Shadow DOM、Canvas 或非标准登录控件可能需要单独适配。
- 如果 UniPass 的服务端 CORS/Cookie 策略禁止扩展页面直接请求，需要由服务端放行扩展来源，或改为受限的门户页面桥接方案。
