# 技术债追踪

> 红绿灯审查中需要跨任务跟进的黄灯进入本文；红灯不得以登记债务代替修复。

## 分级

| 等级 | 含义 | 处理要求 |
| --- | --- | --- |
| P0 | 正确性或安全阻断 | 当前任务修复；影响阶段时在 `CONTEXT.md` 标记 |
| P1 | 用户体验、可靠性或维护风险 | 下个相关迭代优先处理 |
| P2 | 长期结构优化 | 扩展相关能力前处理 |

## 未偿还债务

### TD-002: 真实登录态、一键登录与 Jupiter 生命周期验收

- **等级：** P1
- **位置：** `src/background/service-worker.ts`、`src/background/unipass-login.ts`、`src/popup/popup.ts`
- **问题：** 自动化覆盖 URL、API 和一键登录状态机，但无法模拟真实 Chrome Cookie、飞书/Tec-IAM OAuth 页面、Service Worker 重启、alarm、标签页注入和 UniPass 用户切换。
- **影响：** 登录失效、浏览器重启或切换 UniPass 用户后，Jupiter 托管可能出现状态陈旧或需要人工重新启用。
- **建议：** 建立手动烟测清单；确认用户切换是否应自动关闭托管或把设置绑定到 UniPass 身份，再决定是否新增身份隔离。
- **验证：** 记录 Chrome 版本、UniPass/Jupiter 账号、账户页显示名（仅确认字段是否显示，不记录实际值）、重启/登出/切换步骤和结果；不得记录密码、token 或完整接口响应。

- **代码改进：** Service Worker 启动时校验已保存的 `userScope`、恢复 alarm 并立即执行一次续期；alarm 与用户操作共享单次运行锁；用户切换会关闭 alarm 并清理扩展会话；标签页同步只允许精确 `https://jupiter.tec-do.com` origin，注入函数内再次校验。
- **自动验证：** `tests/url.test.mjs` 覆盖严格 Jupiter origin；`npm run verify` 覆盖治理、静态审查、测试、类型检查和构建。
- **人工烟测清单（完成代码验收后执行）：**
  1. 独立 Chrome Profile 加载 `dist/`，退出 UniPass 后点击“一键登录”，确认同一标签页依次通过“钛动科技”和固定 Tec-IAM 飞书授权页，并最终回到 UniPass；仅记录结果，不记录 URL 中的 `state`/code。
  2. 在飞书需要切换账号、扫码或验证码，以及 OAuth 客户端/回调/权限文案不匹配时，确认扩展不代为操作；再手动登录并确认账户页显示名，仅记录“已显示”。
  3. 打开 Jupiter，Popup 的应用页开启“自动托管”，确认首次登录成功；仅记录按钮状态与页面是否保持登录。
  4. 重启 Chrome，重新打开 Jupiter，等待 Service Worker 恢复，确认无需再次点击即可保持登录。
  5. 在 UniPass 登出或切换另一用户，重新打开 Popup，确认托管关闭；检查 Jupiter 不再被扩展写入新会话。
  6. 关闭托管，确认 alarm 停止且 Jupiter 页面不再被扩展刷新。
  7. 全程不得记录密码、token、OAuth `state`/code、完整接口响应或真实账号值。
- **当前状态：** 自动化与代码防护已完成；上述真实 Chrome/Cookie/alarm/Jupiter 登录态烟测仍待维护者执行，故该债务暂不移除。
## 偿还流程

1. 红绿灯或用户反馈识别问题并分级。
2. 修复时补测试或明确真实浏览器验收。
3. 完成后从活跃清单移除；需要保留复盘时移入 `docs/archive/tech-debt/`，Git 历史保留变更依据。
