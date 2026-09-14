# Chrome 验收清单

## 自动化 smoke

`npm run smoke:chrome` 使用 `puppeteer-core` 和本机 Google Chrome，在临时用户目录加载 `dist/`。Chrome 路径按 `CHROME_BIN`/`CHROME_PATH`、系统 `PATH` 和当前操作系统的标准安装注册信息动态发现；脚本不绑定某个系统的绝对安装路径，也不回退到 Edge。`npm run smoke:chrome:hardened` 会先校验 `artifacts/hardened/` 的报告和完整性哈希，再加载 hardened `dist/`。两者验证 MV3 manifest、Service Worker 注册、popup、本地 `credential-core.wasm` fetch/instantiate、第一代 Self Builder 的三击确认与 ZIP 下载、ZIP 解压后的精确顶层文件结构和自校验，然后关闭第一代浏览器，在新的临时 Profile 加载二代扩展，验证 ID、`runtime-config`、`getPluginVersionSettings`、WASM 和下一代 Self Build 确认框；同时收集 popup 的 console/page error。它们不使用真实账号或密码。

CI 和 Release 分别运行 normal 与 hardened job；normal job 运行 `npm run verify`/独立 WASM 可复现构建，hardened job 运行 `npm run verify:hardened`。无图形 Linux runner 通过 `xvfb-run` 提供显示环境。

## Manual authenticated Chrome acceptance

必须在独立 Chrome Profile 中加载同一份 `dist/`，由维护者使用脱敏/专用测试账号实际确认。不得把真实 credential、token、Cookie、响应或截图提交到仓库。

2026-09-11：维护者已完成真实 UniPass/Jupiter 登录流程验收，暂未发现问题。以下仅勾选已明确完成的登录相关项目；其他手工项目仍保持未勾选，不能由本次登录验收推断通过。

- [x] UniPass session、UniPass login helper 与 Account catalog
- [ ] Credential availability；包含空密码账号不展示（当前应用列表仍可能显示相关应用，见 TD-006）
- [x] Reveal；包含 Unicode password
- [x] Copy username/password
- [x] 60 秒后清除 Reveal 明文
- [x] Popup Fill 与 Overlay Fill
- [x] HTTPS enforcement 与 URL mismatch 拒绝
- [ ] 用户切换后的 scope 隔离；60 秒 TTL、页面离开与新 Reveal 的引用清理
- [ ] Service Worker restart 与 WASM restart initialization
- [x] Jupiter login、keepalive 与 token session sync；确认原始 password 不经过 JS transform path
- [ ] Self Derived Build 在独立 Profile 中解压后直接加载，并确认当前扩展目录可手动覆盖/重新加载

当前范围关闭：Jupiter 适配计划逐步取消，“Disable keepalive cleanup”不再作为当前交付门槛。

自动化 smoke 通过不等于以上真实登录验收通过；未实际执行的项目必须保持未勾选，并在交付报告中标为 Manual / 未验收。
## WebDAV Vault 多设备验收（本轮新增）

以下步骤必须在真实 WebDAV/NAS 或 Nextcloud 上由维护者手工执行，自动测试不能替代。

### Device A

1. 在独立 Chrome Profile 加载同一份 `dist/`，选择“创建新密码库”。
2. 输入 Vault Name、HTTPS WebDAV URL、WebDAV username 和 App Password；保存并连接。
3. 将只显示一次的 Vault Key 保存到离线安全位置；新增 App、Account 和 password，确认当前页 Fill 成功。

### Device B / clean profile

1. 用全新 Chrome Profile 加载扩展，选择“连接已有密码库”，不要选择创建模式。
2. 输入本地显示名称、相同 WebDAV URL、WebDAV App Password 和 Device A 的 Vault Key。
3. 确认读取到 Device A 的 App/Account；确认 catalog、当前页 Fill，以及开启 Advanced capability 后 Reveal/Copy 可用。
4. 使用错误 Vault Key 重试，确认失败、不新增本地 profile、远端无 PUT/覆盖。
5. 删除远端 manifest 后分别验证：空 `objects/` 允许创建新 Vault；已有 `app_`、`account_` 或 `credential_` object 时创建被拒绝。

### Conflict and coexistence

- Device A/B 同时编辑同一 Account，确认后一方收到 conflict，而不是静默覆盖。
- 在 UniPass 登出后，仍能使用已连接 WebDAV Vault 展示 Apps、当前页 Fill 和 Advanced Reveal/Copy；Legacy account 仍要求有效 userScope。
- 验证权限拒绝、401/403、timeout、损坏 ciphertext 和不兼容 WebDAV 响应都显示为 error，不显示为 empty password。

### Current status

真实 NAS/Nextcloud 双设备、权限拒绝、冲突及本机 Chrome authenticated smoke 尚未在本轮实际执行；不得将 `npm run verify` 结果视为这些人工项目已通过。
