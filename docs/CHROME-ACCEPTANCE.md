# Chrome 验收清单

## 自动化 smoke

`npm run smoke:chrome` 使用 `puppeteer-core` 和本机/`CHROME_BIN` 指定的 Chrome，在临时用户目录加载 `dist/`。它验证 MV3 manifest、Service Worker 注册、popup、Service Worker fetch/instantiate 本地 `credential-core.wasm`、CSP 允许 WASM，以及停止/唤醒 Service Worker 后再次初始化 WASM；同时收集 popup 的 console/page error。它不使用真实账号或密码。

CI 和 Release verify job 会先运行 `npm run verify`、独立 WASM 可复现构建，再运行该 smoke。无图形 Linux runner 通过 `xvfb-run` 提供显示环境。

## Manual authenticated Chrome acceptance

必须在独立 Chrome Profile 中加载同一份 `dist/`，由维护者使用脱敏/专用测试账号实际确认。不得把真实 credential、token、Cookie、响应或截图提交到仓库。

- [ ] UniPass session 与 Account catalog
- [ ] Credential availability；包含空密码账号不展示
- [ ] Reveal；包含 Unicode password
- [ ] Copy username/password
- [ ] 60 秒后清除 Reveal 明文
- [ ] Popup Fill 与 Overlay Fill
- [ ] HTTPS enforcement 与 URL mismatch 拒绝
- [ ] 用户切换后的 scope 隔离
- [ ] Service Worker restart 与 WASM restart initialization
- [ ] Jupiter login
- [ ] Jupiter keepalive；确认原始 password 不经过 JS transform path
- [ ] Jupiter token session sync
- [ ] Disable keepalive cleanup

自动化 smoke 通过不等于以上真实登录验收通过；未实际执行的项目必须保持未勾选，并在交付报告中标为 Manual / 未验收。
