# ADR 0002: 用户触发的 UniPass 一键登录

- 状态：已接受
- 日期：2026-09-07

## 背景

扩展依赖浏览器已有 UniPass 会话。实际登录需要先在 UniPass 门户选择“钛动科技”，再在飞书为固定 Tec-IAM 应用授权获取用户身份标识。重复点击影响使用，但扩展不能绕过身份验证、接管 Cookie 或成为任意页面点击器。

## 决策

- 只在 Popup 离线状态的用户点击后启动一键登录，不做后台静默续登。
- Service Worker 只跟踪一个登录标签页，状态保存在 `chrome.storage.session`，两分钟后失效。
- 门户阶段只接受精确 `https://portal.unipass.top/login` 和唯一可见“钛动科技”按钮。
- 飞书阶段只接受精确授权路径、固定 Tec-IAM OAuth `client_id`、固定 `redirect_uri`、非空 `state`、固定应用/权限文案和唯一可见“授权”按钮。
- 不读取、回传或持久化 Cookie、OAuth code、飞书账号数据；账号选择、扫码、验证码、CAPTCHA 或授权内容变化均停止自动操作。

## 后果

用户的一次明确点击可完成当前稳定的两步登录，同时把自动点击限制在已审计身份链路。代价是新增 `https://accounts.feishu.cn/*` host permission，并依赖第三方页面语义；真实 Chrome/OAuth 行为仍需人工烟测。

## 关联文档

- [SECURITY.md](../../SECURITY.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [TECH_DEBT.md](../TECH_DEBT.md)
