# 扩展架构

## 总览

UniPass Minimal 是 Chrome Manifest V3 扩展，由三个运行上下文和共享模块组成：

```text
Popup（展示与用户操作）
  → chrome.runtime message
Service Worker（UniPass API、凭据解密、缓存、Jupiter 保活）
  → 用户点击填入后临时注入
Content Script（定位输入框、写值、派发事件，不提交表单）
```

构建入口由 `build.mjs` 定义，产物进入忽略提交的 `dist/`。

## 模块职责

| 模块 | 职责 | 禁止事项 |
| --- | --- | --- |
| `src/popup/` | 会话状态、目录与账号展示、用户点击查看/复制/填入 | 直接调用 UniPass/Jupiter API；列表阶段批量接收明文密码 |
| `src/background/` | 外部请求、密码解密、插件版本缓存、凭据可用性检查、Jupiter 会话 | 把密码写入持久化存储；无用户选择扩大敏感数据输出 |
| `src/content/` | 当前主文档内查找可见标准输入框并写入 | 常驻注册、自动提交、读取或回传页面数据 |
| `src/shared/types.ts` | 跨上下文消息与数据契约 | 包含运行时副作用 |
| `src/shared/url.ts` | URL 规范化、HTTPS 与 path 匹配纯函数 | 依赖 Chrome API 或 DOM |
| `src/shared/api.ts` | UniPass API 包装、响应校验和密码算法 | UI 状态或 DOM 操作 |

## 关键数据流

- Popup 内部按 `popup.ts`（初始化与事件协调）、`catalog.ts`（目录与账号渲染）、`credentials.ts`（短生命周期凭据与填入）、`settings.ts`（主题与版本设置）和 `dom.ts`/`bridge.ts`（UI 基础设施）拆分。

### 当前页面账号

1. Popup 读取活动 HTTPS 标签页。
2. Popup 从本地目录缓存匹配应用 origin/path；过期时请求 Service Worker 完整同步。
3. Service Worker 只返回账号展示信息；部分失败会显式标记，不能覆盖完整缓存。
4. Popup 仅针对匹配账号请求凭据可用性；后台返回三态，不返回密码。
5. 用户点击“查看”或“填入”后，后台才返回选中账号的凭据。

### Jupiter 保活

用户主动启用后，Service Worker 定时重新获取对应 UniPass 凭据、登录 Jupiter，并把会话数据放在 `chrome.storage.session`。同步到匹配标签页后由页面使用；关闭保活会清除 alarm 和会话缓存。

## 存储边界

| 位置 | 允许内容 |
| --- | --- |
| Popup `localStorage` | 主题、按用户隔离的账号目录展示信息；不含密码 |
| `chrome.storage.local` | 插件版本覆盖/TTL 缓存、Jupiter 保活配置与结果；不含密码/token |
| `chrome.storage.session` | 凭据可用性状态、Jupiter 会话；随浏览器会话清除 |
| 内存/消息 | 用户选中账号的短生命周期明文密码 |

## 变更规则

- 消息字段变化同时更新 `types.ts`、发送端、接收端和测试。
- URL 或权限边界优先写成 `shared` 纯函数并单测。
- 新外部服务必须先定义 host permission、超时、错误语义、敏感数据生命周期和关闭方式。
- Popup 模块职责已拆分；新增功能应归入对应模块，保持入口只负责初始化与事件协调。
