export type VaultBackendType = "legacy-unipass" | "webdav" | "cloudflare" | "github";
export type RevisionToken = string;
export type VaultObjectKind = "manifest" | "app" | "account" | "credential";

export interface AccountRef {
  vaultId: string;
  accountId: string;
}

export interface AppRef {
  vaultId: string;
  appId: string;
}

export interface VaultTarget {
  scheme: "https";
  host: string;
  pathPrefix?: string;
  includeSubdomains?: boolean;
}

export interface VaultProfile {
  id: string;
  name: string;
  backend: VaultBackendType;
  enabled: boolean;
  endpoint?: string;
}

/**
 * The recovery key is returned only immediately after creating a new Vault.
 * Callers must keep it in memory only and clear it when their UI closes.
 */
export interface VaultConnection {
  profile: VaultProfile;
  recoveryKey?: string;
}

export interface VaultApp {
  id: string;
  vaultId: string;
  name: string;
  targets: VaultTarget[];
  favorite?: boolean;
  deletedAt?: number;
}

export interface VaultAccount {
  id: string;
  vaultId: string;
  appId: string;
  username: string;
  remark?: string;
  favorite?: boolean;
  credentialId: string;
  deletedAt?: number;
}

export interface VaultCredential {
  username: string;
  password: string;
}

export interface StoredObjectMeta {
  id: string;
  revision: RevisionToken;
  kind?: VaultObjectKind;
}

export interface StoredObject extends StoredObjectMeta {
  data: Uint8Array;
}

export interface VaultBackend {
  connect(): Promise<void>;
  getManifest(): Promise<StoredObject | null>;
  list(): Promise<StoredObjectMeta[]>;
  get(id: string): Promise<StoredObject | null>;
  put(id: string, data: Uint8Array, expectedRevision?: RevisionToken): Promise<StoredObjectMeta>;
  delete(id: string, expectedRevision?: RevisionToken): Promise<void>;
}

export interface EncryptedVaultObject {
  formatVersion: 1;
  id: string;
  kind: VaultObjectKind;
  keyVersion: number;
  algorithm: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
}

export interface VaultCatalog {
  apps: VaultApp[];
  accounts: VaultAccount[];
}

export class VaultConflictError extends Error {
  readonly code = "revision-conflict";

  constructor() {
    super("该记录已在另一台设备修改，请先同步后重试");
    this.name = "VaultConflictError";
  }
}

export class VaultFormatError extends Error {
  constructor(message = "Vault 数据格式不受支持") {
    super(message);
    this.name = "VaultFormatError";
  }
}

export class VaultCryptoError extends Error {
  constructor() {
    super("Vault 对象解密失败");
    this.name = "VaultCryptoError";
  }
}

export class VaultRemoteDataError extends Error {
  constructor() {
    super("该 WebDAV 目录已有密码库数据，但无法用当前 Vault Key 解密。请换一个空目录，或选择已有密码库并粘贴正确的 Vault Key");
    this.name = "VaultRemoteDataError";
  }
}

export class VaultKeyFormatError extends Error {
  constructor() {
    super("Vault Key 格式无效。请使用创建密码库时显示的完整 Vault Key");
    this.name = "VaultKeyFormatError";
  }
}

export class WebDavCompatibilityError extends Error {
  constructor(message = "WebDAV 服务器不兼容") {
    super(message);
    this.name = "WebDavCompatibilityError";
  }
}
