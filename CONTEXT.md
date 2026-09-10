# 当前状态

> **最后确认：** 2026-09-10
> **阶段：** Manifest V3 浏览器扩展，版本 `5.3.3`；核心查询、查看/填入、目录匹配、UniPass 一键登录和 Jupiter 会话保活已接入。

## 当前决策

- 凭据列表先由 Service Worker 检查可用性；空密码账号不展示，Popup 仅在用户点击“查看”或“填入”后接收选中账号的明文密码。
- 填充仅允许 HTTPS 且需匹配应用 origin/path；Content Script 按用户操作临时注入，不自动提交。
- UniPass 离线状态的一键登录由用户点击触发，只在一个标签页、两分钟窗口内操作精确的门户登录页和固定 Tec-IAM 飞书 OAuth 授权页；不读取或保存 Cookie、授权码和飞书页面数据，非预期身份验证由用户处理。
- 本地 manifest 为商店版的下一补丁版，阻止浏览器用商店扩展覆盖；UniPass 网络请求默认发送构建时同步的 `STORE_PLUGIN_VERSION`（当前商店基线 `5.3.2`），每次开发/验证均在线核验。商店版变更时必须同步网络基线，并把本地构建更新为其下一补丁版；用户可临时手动覆盖三段数字请求版号，且不影响发布门禁或本地 `5.3.3`。
- 最近客观验证：2026-09-10 `npm run verify` 通过（治理检查、静态绿灯审计、48 项测试、类型检查、标准压缩构建和最终产物审计）；发布包以精确文件白名单阻断源码/source map、调试语句、常见私钥/API token 格式和未审计文件，TD-003 已归档。Service Worker 已拆为 116 行的事件/消息入口、276 行的 Jupiter 保活模块和 23 行的用户作用域守卫。维护者确认真实 Chrome 的账户/凭据、页面浮层、一键登录异常分支及 Jupiter 重启、失效、用户切换、关闭托管场景均已验收通过，TD-002 已归档。目录、凭据与 Jupiter 保活优先以服务端 ID 隔离，缺失时回退到服务端登录名或邮箱；账户页昵称仅在 Popup 内存中作为用户名悬停提示。木星单页应用仅在其已授权同源内允许路由变化。UniPass/Jupiter 请求与 JSON 解析统一为 12 秒超时。
- 私人本地构建以商店扩展 `gjphikebcceegfolnbfncepfmjnhdkam` 的公开 key 固定 ID；每次验证动态查询商店版号，并强制本地与之同主、次版本且补丁号恰高 `1`；每个新商店基线只发布一次对应 GitHub Release。仅允许开发者模式加载，不具备商店发布或签名权。

## 近期优先级

1. 维护者已确认 TD-004 的人工盘点与验收完成；待获得已确认的试点协议和接口契约后，在功能开关下实施服务端化会话接入。

## 按需入口

- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 审查与验证：[docs/AI_RULES.md](docs/AI_RULES.md)
- 活跃技术债：[docs/TECH_DEBT.md](docs/TECH_DEBT.md)
- 长期决策：[docs/ADR/README.md](docs/ADR/README.md)
