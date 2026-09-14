# TD-008：本地解锁密码

- **状态：** 已关闭
- **关闭日期：** 2026-09-14
- **实现：** WebDAV 连接材料可由用户主动启用的本地解锁密码封装为 `PBKDF2-SHA-256` 派生密钥和 `AES-256-GCM` ciphertext，写入 `chrome.storage.local`。本地解锁密码不保存，失败次数仅在 `chrome.storage.session`，五次失败后锁定；支持显式 `lockVault`、`disableLocalUnlock` 与连接移除清除路径。
- **安全边界：** 明文 Vault Key、WebDAV username/App Password 仍只在运行时 session/内存中使用；local 仅保存加密封装。该模式不引入 Native Messaging，不自动迁移旧凭据，不改变 Legacy UniPass。
- **验证：** `npm test` 包含错误密码、ciphertext 不含 fixture secret、正确密码恢复材料的自动测试；真实浏览器中的密码管理器/系统存储行为仍按 Chrome 验收清单人工确认。
