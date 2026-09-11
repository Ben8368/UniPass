# Chrome 验收清单

## 自动化 smoke

`npm run smoke:chrome` 使用 `puppeteer-core` 和本机 Google Chrome，在临时用户目录加载 `dist/`。Chrome 路径按 `CHROME_BIN`/`CHROME_PATH`、系统 `PATH` 和当前操作系统的标准安装注册信息动态发现；脚本不绑定某个系统的绝对安装路径，也不回退到 Edge。`npm run smoke:chrome:hardened` 会先校验 `artifacts/hardened/` 的报告和完整性哈希，再加载 hardened `dist/`。两者验证 MV3 manifest、Service Worker 注册、popup、本地 `credential-core.wasm` fetch/instantiate、第一代 Self Builder 的三击确认与 ZIP 下载、ZIP 解压后的精确顶层文件结构和自校验，然后关闭第一代浏览器，在新的临时 Profile 加载二代扩展，验证 ID、`runtime-config`、`getPluginVersionSettings`、WASM 和下一代 Self Build 确认框；同时收集 popup 的 console/page error。它们不使用真实账号或密码。

CI 和 Release 分别运行 normal 与 hardened job；normal job 运行 `npm run verify`/独立 WASM 可复现构建，hardened job 运行 `npm run verify:hardened`。无图形 Linux runner 通过 `xvfb-run` 提供显示环境。

## Manual authenticated Chrome acceptance

必须在独立 Chrome Profile 中加载同一份 `dist/`，由维护者使用脱敏/专用测试账号实际确认。不得把真实 credential、token、Cookie、响应或截图提交到仓库。

- [ ] UniPass session、UniPass login helper 与 Account catalog
- [ ] Credential availability；包含空密码账号不展示
- [ ] Reveal；包含 Unicode password
- [ ] Copy username/password
- [ ] 60 秒后清除 Reveal 明文
- [ ] Popup Fill 与 Overlay Fill
- [ ] HTTPS enforcement 与 URL mismatch 拒绝
- [ ] 用户切换后的 scope 隔离；60 秒 TTL、页面离开与新 Reveal 的引用清理
- [ ] Service Worker restart 与 WASM restart initialization
- [ ] Jupiter login、keepalive 与 token session sync；确认原始 password 不经过 JS transform path
- [ ] Disable keepalive cleanup
- [ ] Self Derived Build 在独立 Profile 中解压后直接加载，并确认当前扩展目录可手动覆盖/重新加载

自动化 smoke 通过不等于以上真实登录验收通过；未实际执行的项目必须保持未勾选，并在交付报告中标为 Manual / 未验收。
