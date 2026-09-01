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
- `https://portal.unipass.top/*`：调用 UniPass API，并使用浏览器已有的 UniPass 登录会话。

扩展不申请 `tabs`、`cookies`、`privacy`、`storage`、`webNavigation`、`contextMenus`、`declarativeNetRequest` 或 `<all_urls>`，也不注册常驻 Content Script。

## 本地构建与加载

```powershell
npm install
npm run typecheck
npm run build
```

打开 `chrome://extensions`，开启开发者模式，然后加载已解压的 `dist` 目录。

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
- 为保持服务器协议兼容，请求使用原插件兼容版本 `5.3.0` 的 Header。
- 当前版本不监听 Cookie；若登录状态变化，重新打开 Popup 即可刷新。
- 当前版本不自动清空系统剪贴板。最小权限下无法安全确认剪贴板是否已被用户的新内容替换，强制清空可能误删用户内容。

## 已知限制

- 跨域 iframe 内的登录框不会填充。
- 高度定制的 Shadow DOM、Canvas 或非标准登录控件可能需要单独适配。
- 如果 UniPass 的服务端 CORS/Cookie 策略禁止扩展页面直接请求，需要由服务端放行扩展来源，或改为受限的门户页面桥接方案。