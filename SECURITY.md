# 安全策略与边界

## 保护目标

本扩展处理 UniPass 账号展示信息、短生命周期明文密码和 Jupiter 会话。首要目标是减少凭据暴露、限制可填充页面，并让权限、网络和缓存行为可审计。

## 强制安全不变量

- 明文密码不得写入 `localStorage`、`chrome.storage`、日志、错误文本、测试 fixture 或构建产物。
- Popup 列表渲染只接收凭据可用性状态；只有用户点击“查看”或“填入”后才能接收一个选中账号的密码。
- 填充只允许 HTTPS 且与应用 URL 的 origin/path 匹配；执行前重新检查标签页仍活动且未导航到其他应用。
- Content Script 只按用户操作临时注入，只写标准可见输入框，不自动提交表单。
- Jupiter token 只保存在 `chrome.storage.session` 和目标站点自身 session/local storage；关闭托管时清除扩展会话副本。
- API、解密或目录同步失败必须显式失败；未知错误不得被缓存成“空密码”，部分目录不得覆盖上次完整目录。

## 权限与主机

权限和 host permissions 以 `public/manifest.json` 为唯一运行事实：

- `activeTab`、`scripting`：用户触发的当前页填充。
- `clipboardWrite`：用户点击复制。
- `storage`：非明文设置、TTL 状态和会话数据。
- `alarms`、`tabs`：用户主动开启的 Jupiter 保活与标签页同步。
- UniPass、Chrome 更新服务、Jupiter 是当前仅允许的外部主机。
- 私人本地构建的 manifest `key` 固定为商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 ID；该值不是私钥，不授予商店发布或 CRX 签名权限。因同一 ID 可能与商店版争用 Profile 状态，必须在独立 Profile 完成人工安装验收。

新增权限或域名前必须说明最小必要范围、数据内容、触发条件、失败/关闭路径，并更新本文件、README 和红绿灯报告。

## 已知边界

- 浏览器扩展无法阻止目标 HTTPS 页面自身脚本读取已填入的输入框；因此必须依赖应用 URL 匹配和用户明确操作。
- 系统剪贴板不会自动清空，避免覆盖用户后来复制的内容。
- 跨域 iframe、关闭的 Shadow DOM、Canvas 和非标准登录控件不在通用填充承诺内。
- 真实 UniPass/Jupiter 行为依赖外部服务和登录状态，自动化测试不能替代手动集成验收。

## 安全变更检查

涉及凭据、权限、外部请求、存储、URL 匹配、Content Script 或 Jupiter 保活时：

1. 阅读 `AGENTS.md`、`CONTEXT.md`、`docs/AI_RULES.md`、`docs/ARCHITECTURE.md` 和本文件。
2. 在验证前输出 `🚦 Audit Report`，红灯修复后再继续。
3. 运行 `npm run verify`，并记录无法自动化的真实浏览器验收。
4. 若长期边界变化，新增或更新 ADR。

发现漏洞时不要在公开 issue 中粘贴凭据、token 或完整响应；使用仓库托管平台的私密安全报告渠道，或先联系维护者提供脱敏复现。
