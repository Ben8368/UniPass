# ADR 0004: Local-first Vault Cache and Browser Import

- 状态：已接受
- 日期：2026-09-15

## 背景

WebDAV Vault 需要在网络不可用时继续提供目录、Fill 和本地修改，同时保持跨设备恢复、opaque ETag 版本和 tombstone 语义。浏览器密码迁移需要支持 Chrome/Edge 导出的 CSV，但扩展不能读取 Chromium 内部密码库或把 CSV 上传到远程服务。

## 决策

- 首次成功连接后，使用现有 AES-256-GCM envelope 建立按 `vaultId/objectId` 隔离的 IndexedDB encrypted local cache。缓存只存 ciphertext、local revision、远端 ETag、更新时间和 `clean`/`dirty`/`conflict` 状态，不存明文 credential、Vault Key 或 WebDAV secret。
- `VaultCore` 继续是唯一 App/Account/Credential CRUD 入口，local cache 是 primary runtime backend；WebDAV 是同步和跨设备恢复 backend。Service Worker 的 `VaultSyncEngine` 使用条件 PUT 和 ETag，冲突 fail closed，不采用 last-write-wins。
- 本地写入先返回并进入 dirty queue；网络恢复、Service Worker 启动和周期 alarm 触发同步。业务删除继续由 VaultCore 写入加密 tombstone。
- 浏览器 CSV 只能由用户主动选择。解析、预览和规范化与 Vault 解耦；确认后由 Service Worker 经 VaultCore 写入，失败逐条报告。UniPass 不读取/修改/删除 Chrome 或 Edge 密码库，用户自行删除浏览器原密码。

## 后果

已同步设备可完全离线读取、Fill、Reveal（仍受现有 Advanced/WebAuthn/PIN 保护）和修改；首次设备仍必须通过 WebDAV 与 Vault Key 建立缓存。缓存初始化失败不会破坏远端对象，但该设备暂时不能获得离线能力。冲突需要后续显式处理，避免静默覆盖。

## 关联文档

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../../SECURITY.md)
- [README.md](../../README.md)
- [CONTEXT.md](../../CONTEXT.md)
