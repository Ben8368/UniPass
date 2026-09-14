# ADR 0003: 密码学实现边界与 Legacy UniPass 退役原则

- 状态：已接受
- 日期：2026-09-14

## 背景

Legacy UniPass 仍是实际使用中的受支持能力。当前 UniPass AES legacy decrypt 以及 Jupiter MD5/DES transform 位于 Rust `credential-core.wasm`，并已有 Rust QA、固定 toolchain、reproducible/hardened build、artifact audit 和 Chrome smoke 等配套体系。新的 Vault 使用 Web Crypto AES-256-GCM；本地解锁当前使用 PBKDF2-SHA-256 + AES-256-GCM。

Rust/WASM 的存在应由明确的能力需求证明，而不是因为代码敏感或属于密码学就默认迁入。WASM 不是 secure enclave，也不能阻止拥有扩展执行权限的攻击者取得运行时材料。

## 决策

- Legacy 当前继续保留并正常支持；本 ADR 不改变运行行为，也不表示 Legacy removal 已完成。
- 当前 `credential-core.wasm` 保持 Legacy compatibility 职责。当前不为统一技术栈把 Vault AES-GCM、Vault envelope 或其他新的 Vault crypto 迁入 Rust/WASM。
- Vault 的 AEAD、CSPRNG 和 `CryptoKey` 生命周期默认由 Web Crypto 承担。
- Rust/WASM 的收益应来自特定算法能力、实现集中、secret lifecycle、zeroize、协议兼容和可审计性，而不是“把 key 藏在 WASM 中”。
- Legacy 真正退役后，默认删除现有 `credential-core` 及其配套复杂度：删除 Legacy backend/compatibility path、UniPass AES legacy decrypt、Jupiter MD5/DES transform、对应 WASM ABI、只为这些协议存在的 Rust dependencies、测试和 artifact 规则；随后重新检查项目是否仍有明确的 WASM 使用场景。没有明确场景时，进一步删除 Rust/WASM build chain、artifact handling、WASM-specific hardening/reproducibility/audit/release gates，以及仅因 WASM 存在的 CSP 和构建特例。不得自动把旧 core 扩展成通用 Vault crypto core。
- 本地解锁当前保持 PBKDF2-SHA-256 + AES-256-GCM。Legacy 退役后，只有在威胁模型、benchmark 和维护成本证明离线口令破解成本提升足以覆盖长期成本时，才单独评估 `PBKDF2-SHA-256 -> Argon2id`；Argon2id 不是本次实施内容，也不是既定功能。若未来采用，优先评估职责极小、仅负责 password KDF / secret buffer lifecycle 的 capability-oriented `vault-kdf.wasm`，AES-GCM 和随机数仍优先使用 Web Crypto。
- 如果未来仍需 WASM，模块应保持职责极小并采用 capability-oriented naming，不使用笼统的 `security-core` 或 `crypto-core`。

## 后果

当前 Legacy compatibility 可以继续获得既有质量和审计保障，Vault crypto 不会因技术栈统一而扩大 WASM 边界。代价是 Legacy 退役时需要一次有明确验收条件的收缩工作，并重新评估 WASM、CSP、构建和发布基础设施是否仍有用途；未来 KDF 选择也必须作为独立架构决策处理。

## 关联文档

- [CONTEXT.md](../../CONTEXT.md)
- [TECH_DEBT.md](../TECH_DEBT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../../SECURITY.md)
