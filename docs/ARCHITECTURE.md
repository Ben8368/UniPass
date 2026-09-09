# 扩展架构

## 总览

UniPass Minimal 是 Chrome Manifest V3 扩展，由三个运行上下文和共享模块组成：

```text
Popup / 页面浮层（展示与用户操作）
  → chrome.runtime message
Service Worker（UniPass API、登录辅助、凭据解密、缓存、Jupiter 保活）
  → 用户点击填入后临时注入
Content Script（定位输入框、写值、派发事件，不提交表单）
```

用户点击扩展 Action 后，Service Worker 只在当前 HTTPS 标签页临时注入 `content/page-overlay.js`，并在浮层初始化时检测当前页面主题；未手动指定主题时，白色页面使用浅色、深色页面使用暗色。该脚本挂载 closed Shadow DOM 浮层，复用 Popup 的展示控制器；点击页面外部、按 Escape、再次点击 Action 或页面离开时移除浮层。对于 HTTP、浏览器内部页和其他不可注入上下文，Action 改为打开扩展自身 Popup，不会尝试注入页面脚本。浮层不读取页面内容，只通过消息向 Service Worker 请求会话、目录和用户选中的凭据操作。Manifest 仅向 HTTPS 页面公开浮层所需的三个品牌图标。

离线状态下，Popup 的“一键登录”消息由 Service Worker 交给独立的 `unipass-login.ts` 状态机；它不经过通用 Content Script，也不接触凭据。

构建入口由 `build.mjs` 定义，产物进入忽略提交的 `dist/`。

## 模块职责

| 模块 | 职责 | 禁止事项 |
| --- | --- | --- |
| `src/popup/` | Popup/页面浮层的会话状态、目录与账号展示、用户点击查看/复制/填入 | 直接调用 UniPass/Jupiter API；列表阶段批量接收明文密码 |
| `src/background/` | 外部请求、UniPass 登录辅助、密码解密、凭据可用性检查、Jupiter 会话 | 把密码写入持久化存储；无用户选择扩大敏感数据输出 |
| `src/content/` | 用户点击扩展后挂载页面浮层，或用户点击填入后在当前主文档内查找可见标准输入框并写入 | 常驻注册、自动提交、读取或回传页面数据 |
| `src/shared/types.ts` | 跨上下文消息与数据契约 | 包含运行时副作用 |
| `src/shared/url.ts` | URL 规范化、HTTPS 与 path 匹配纯函数 | 依赖 Chrome API 或 DOM |
| `src/shared/api.ts` | UniPass API 包装、响应校验和密码算法 | UI 状态或 DOM 操作 |

`src/background/credential-availability.ts` 独立封装凭据可用性并发检查和 15 分钟会话缓存；只缓存三态结果，不返回或持久化明文密码。
`src/background/unipass-login.ts` 只处理用户触发的 UniPass/Tec-IAM 登录：复用或新建一个登录标签页，在两分钟窗口内依次校验并点击唯一的“钛动科技”和“授权”按钮。飞书阶段固定校验 OAuth `client_id`、`redirect_uri`、非空 `state` 和授权文案；离开已知认证 origin、完成授权、关闭标签页或超时后即清除状态。

## 关键数据流

- Popup 内部按 `popup.ts`（初始化与事件协调）、`catalog.ts`（目录与账号渲染）、`credentials.ts`（短生命周期凭据与填入）、`settings.ts`（主题与版本信息）和 `dom.ts`/`bridge.ts`（UI 基础设施）拆分。`getPluginVersionSettings` 返回本地构建、商店基线、当前网络提交及其来源；`setPluginVersionOverride` 仅接受三段数字版号并由 Service Worker 存入 `chrome.storage.local`。默认基线来自构建时同步的 `STORE_PLUGIN_VERSION`；Popup 可临时覆盖请求头但不改变构建/发布约束，运行时也不查询商店。
- 页面浮层的 `pageContext`、页面主题、应用打开和填入消息由 Service Worker 以发送者标签页为准重新校验；页面主题检测仅读取当前 HTTPS 页面的渲染背景色与 `color-scheme`，不读取页面正文、Cookie、表单值或页面存储；浮层不能自行指定目标标签页，也不能绕过 HTTPS/origin/path 匹配。

### 当前页面账号

1. Service Worker 从 `/session/current_user` 获取当前 UniPass 会话；账户页昵称 `nickName` 按用户请求仅传入 Popup 内存，用于用户名悬停提示，绝不持久化或参与身份作用域。Popup 的用户作用域优先服务端稳定 ID，缺失时使用服务端登录名，再回退邮箱；昵称和姓名不参与作用域。三者均缺失时不执行需要用户身份的目录、应用或凭据请求。
2. Popup/页面浮层读取或接收当前 HTTPS 标签页上下文；木星单页应用仅在其已授权的同一 origin 内允许路由变化，其他应用仍要求 origin/path 匹配。
3. Popup 从本地目录缓存匹配应用 origin/path；过期时请求 Service Worker 完整同步。
4. Service Worker 校验用户作用域后只返回账号展示信息；部分失败会显式标记，不能覆盖完整缓存。
5. Popup 仅针对匹配账号请求凭据可用性；后台返回三态，不返回密码。
6. 用户点击“查看”或“填入”后，后台再次校验用户作用域才返回选中账号的凭据。

### Jupiter 保活

用户主动启用后，Service Worker 要求稳定用户作用域，每 25 分钟重新获取对应 UniPass 凭据并向 Jupiter 提交登录 `POST`，把带用户作用域的会话数据放在 `chrome.storage.session`。新 token 同步到已打开的 Jupiter 页面时只静默更新其同源会话存储，不触发 `storage` 鉴权事件，也不执行页面刷新，避免被前端误判为“退出再登录”。每次 alarm 和标签页同步前都会核验当前 UniPass 用户；检测到切换时停止 alarm 并清除会话缓存。关闭保活也会清除 alarm 和会话缓存。外部请求超时为 12 秒。

### UniPass 一键登录

1. Popup 会话请求失败后显示“一键登录”；用户点击时发送 `startUniPassLogin`。
2. Service Worker 复用精确 `/login` 标签页或打开新标签页，并把标签页 ID、阶段和两分钟过期时间写入 `chrome.storage.session`。
3. 登录状态写入后即以 `injectImmediately` 在精确 UniPass 登录页检查并点击唯一“钛动科技”按钮，不等待页面 `complete`；同标签页跳转至飞书后，同样尽早校验固定 Tec-IAM OAuth 参数、应用名和权限文案并点击唯一“授权”按钮。
4. 授权后仍由现有 `/session/current_user` 判定 UniPass 会话；扩展不读取 OAuth code 或 Cookie。异常页面、账号选择、扫码、验证码和 CAPTCHA 留给用户处理。

## 存储边界

| 位置 | 允许内容 |
| --- | --- |
| Popup `localStorage` | 主题、按用户隔离的账号目录展示信息；不含密码 |
| `chrome.storage.local` | Jupiter 保活配置与结果、手动网络版号覆盖；不含密码/token |
| `chrome.storage.session` | 凭据可用性状态、Jupiter 会话；随浏览器会话清除 |
| `chrome.storage.session` 登录项 | 当前一键登录的标签页 ID、阶段和两分钟过期时间；不含 Cookie、授权码或用户资料 |
| 内存/消息 | 用户选中账号的短生命周期明文密码 |

## 变更规则

- 消息字段变化同时更新 `types.ts`、发送端、接收端和测试。
- URL 或权限边界优先写成 `shared` 纯函数并单测。
- 新外部服务必须先定义 host permission、超时、错误语义、敏感数据生命周期和关闭方式。
- Popup 模块职责已拆分；新增功能应归入对应模块，保持入口只负责初始化与事件协调。
