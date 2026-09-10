# TD-005：Rust credential core hardening

状态：Done（2026-09-10）。

已完成：

- ABI allocation `Input`/`Output` kind、64 个 live allocation 上限、边界/ownership fail-closed 与 Node/WASM adversarial tests；
- `npm run verify` 纳入 Rust 1.98.1 fmt、native test、native/wasm clippy 和 WASM release build；
- 两个隔离 Cargo target 目录的 byte-for-byte WASM reproducibility check；
- WASM magic/version、imports/exports、`name`/`producers` custom section 与敏感材料审计；
- CI/Release RustSec gate、完整 SHA pin 的 Actions、Dependabot、验证/发布权限拆分；
- Puppeteer-core Chrome smoke：unpacked MV3、popup、Service Worker、WASM fetch/instantiate、CSP 和 Service Worker restart；
- 人工 authenticated Chrome 清单见 [Chrome 验收清单](../../CHROME-ACCEPTANCE.md)。未实际执行的登录态项目不得标为通过。

保留边界：Reveal/Fill 必须短暂把明文交给 JS/页面；运行时调试、WASM 逆向和客户端协议材料提取仍无法由客户端彻底阻止。TD-004 仍为外部依赖阻断，不属于本债务。
