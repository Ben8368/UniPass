import { decryptVaultObject, encryptVaultObject } from "../../shared/vault-crypto";
import {
  VaultFormatError,
  VaultRemoteDataError,
  type AccountRef,
  type StoredObject,
  type VaultAccount,
  type VaultAccountUpdate,
  type VaultApp,
  type VaultBackend,
  type VaultCatalog,
  type VaultCredential,
  type VaultManifestPayload,
  type VaultTarget,
} from "../../shared/vault";

const MANIFEST_ID = "manifest";

export class VaultCore {
  constructor(readonly vaultId: string, private readonly backend: VaultBackend, private readonly key: CryptoKey) {}

  /** Legacy-compatible entry point; new callers should choose create() or open(). */
  async initialize(): Promise<void> {
    const manifest = await this.backend.getManifest();
    if (manifest) {
      const decoded = await decryptVaultObject<VaultManifestPayload>(this.key, manifest.data);
      if (decoded.envelope.id !== MANIFEST_ID || decoded.envelope.kind !== "manifest" || decoded.envelope.keyVersion !== 1 || !isManifest(decoded.payload) || decoded.payload.vaultId !== this.vaultId) throw new VaultFormatError();
      return;
    }
    if ((await this.backend.list()).length) throw new VaultRemoteDataError();
    await this.backend.put(MANIFEST_ID, await encryptVaultObject(this.key, MANIFEST_ID, "manifest", { vaultId: this.vaultId, schemaVersion: 1 satisfies 1 }));
  }

  /** Creates a brand-new Vault only after proving its object collection contains no Vault data. */
  static async create(vaultId: string, backend: VaultBackend, key: CryptoKey): Promise<VaultCore> {
    const core = new VaultCore(vaultId, backend, key);
    const manifest = await backend.getManifest();
    if (manifest) throw new VaultRemoteDataError("目标 WebDAV 目录已有密码库数据且存在 manifest。请选择“连接已有密码库”。");
    const existing = await backend.list();
    if (existing.length) throw new VaultRemoteDataError();
    const data = await encryptVaultObject(key, MANIFEST_ID, "manifest", { vaultId, schemaVersion: 1 satisfies 1 });
    await backend.put(MANIFEST_ID, data);
    return core;
  }

  /** Opens an existing Vault and derives its identity exclusively from the encrypted remote manifest. */
  static async open(backend: VaultBackend, key: CryptoKey): Promise<VaultCore> {
    const manifest = await backend.getManifest();
    if (!manifest) throw new VaultRemoteDataError("目标位置没有可连接的 UniPass Vault（缺少 manifest）。");
    const decoded = await decryptVaultObject<VaultManifestPayload>(key, manifest.data);
    if (decoded.envelope.id !== MANIFEST_ID || decoded.envelope.kind !== "manifest" || decoded.envelope.keyVersion !== 1 || !isManifest(decoded.payload)) throw new VaultFormatError();
    return new VaultCore(decoded.payload.vaultId, backend, key);
  }

  async catalog(): Promise<VaultCatalog> {
    const metas = await this.backend.list();
    const apps: VaultApp[] = [];
    const accounts: VaultAccount[] = [];
    for (const meta of metas) {
      if (meta.id.startsWith("app_")) {
        const object = await this.backend.get(meta.id);
        if (object) apps.push((await this.readApp(meta.id.slice(4), object)).value);
      } else if (meta.id.startsWith("account_")) {
        const object = await this.backend.get(meta.id);
        if (object) accounts.push((await this.readAccount(meta.id.slice(8), object)).value);
      }
    }
    return { apps: apps.filter((app) => !app.deletedAt), accounts: accounts.filter((account) => !account.deletedAt) };
  }

  async credential(ref: AccountRef): Promise<{ username: string; password: string }> {
    if (ref.vaultId !== this.vaultId) throw new Error("Vault 引用不匹配");
    const account = await this.readAccount(ref.accountId);
    if (account.value.deletedAt) throw new Error("该账号已删除");
    const credential = await this.readCredential(account.value.credentialId);
    if (!credential || credential.value.deletedAt) throw new Error("该账号没有可用凭据");
    return { username: account.value.username, password: credential.value.password };
  }

  /** Only a missing/tombstoned credential or an empty password is business-empty; other failures throw. */
  async credentialAvailability(ref: AccountRef): Promise<"available" | "empty"> {
    if (ref.vaultId !== this.vaultId) throw new Error("Vault 引用不匹配");
    const account = await this.readAccount(ref.accountId);
    if (account.value.deletedAt) return "empty";
    const credential = await this.readCredential(account.value.credentialId, true);
    if (!credential || credential.value.deletedAt || !credential.value.password) return "empty";
    return "available";
  }

  async createApp(input: Omit<VaultApp, "id" | "vaultId">): Promise<VaultApp> {
    const app: VaultApp = { ...input, id: randomId(), vaultId: this.vaultId, targets: validateTargets(input.targets) };
    await this.create("app", app.id, app);
    return app;
  }

  async updateApp(app: VaultApp): Promise<VaultApp> {
    const current = await this.readApp(app.id);
    const next = { ...app, vaultId: this.vaultId, targets: validateTargets(app.targets), deletedAt: undefined };
    await this.update("app", app.id, next, current.stored.revision);
    return next;
  }

  async deleteApp(id: string): Promise<void> {
    const current = await this.readApp(id);
    const catalog = await this.catalog();
    if (catalog.accounts.some((account) => account.appId === id)) throw new Error("该应用仍包含账号，请先删除账号");
    await this.update("app", id, { ...current.value, deletedAt: Date.now() }, current.stored.revision);
  }

  async createAccount(input: Omit<VaultAccount, "id" | "vaultId" | "credentialId"> & { password: string }): Promise<VaultAccount> {
    const app = await this.readApp(input.appId);
    if (app.value.deletedAt) throw new Error("应用已删除");
    const accountId = randomId();
    const credentialId = randomId();
    const { password, ...accountInput } = input;
    const account: VaultAccount = { ...accountInput, id: accountId, vaultId: this.vaultId, credentialId };
    const created = await this.create("credential", credentialId, { password });
    try {
      await this.create("account", accountId, account);
    } catch (error) {
      try { await this.update("credential", credentialId, { password: "", deletedAt: Date.now() }, created.revision); }
      catch { throw new Error("创建账号失败，且无法清理已创建的凭据 tombstone；请同步后检查密码库"); }
      throw error;
    }
    return account;
  }

  async updateAccount(account: VaultAccountUpdate): Promise<VaultAccount> {
    const current = await this.readAccount(account.id);
    const app = await this.readApp(account.appId);
    if (app.value.deletedAt) throw new Error("应用已删除");
    const next: VaultAccount = {
      ...current.value,
      appId: account.appId,
      username: account.username,
      remark: account.remark,
      favorite: account.favorite,
      vaultId: this.vaultId,
      credentialId: current.value.credentialId,
      deletedAt: undefined,
    };
    await this.update("account", account.id, next, current.stored.revision);
    return next;
  }

  /** Credential is tombstoned first; a failed second write leaves the account visible and recoverable. */
  async deleteAccount(id: string): Promise<void> {
    const account = await this.readAccount(id);
    if (account.value.deletedAt) return;
    const credential = await this.readCredential(account.value.credentialId);
    if (credential && !credential.value.deletedAt) await this.update("credential", account.value.credentialId, { password: "", deletedAt: Date.now() }, credential.stored.revision);
    await this.update("account", id, { ...account.value, deletedAt: Date.now() }, account.stored.revision);
  }

  async updateCredential(ref: AccountRef, credential: VaultCredential): Promise<void> {
    if (ref.vaultId !== this.vaultId || !isCredential(credential)) throw new Error("凭据格式无效");
    const account = await this.readAccount(ref.accountId);
    if (account.value.deletedAt) throw new Error("该账号已删除");
    const object = await this.readCredential(account.value.credentialId);
    if (!object || object.value.deletedAt) throw new Error("该账号没有可用凭据");
    await this.update("credential", account.value.credentialId, { password: credential.password }, object.stored.revision);
  }

  private async create(kind: "app" | "account" | "credential", id: string, payload: unknown): Promise<{ revision: string }> {
    const storageId = objectId(kind, id);
    return this.backend.put(storageId, await encryptVaultObject(this.key, storageId, kind, payload));
  }
  private async update(kind: "app" | "account" | "credential", id: string, payload: unknown, revision: string): Promise<void> {
    const storageId = objectId(kind, id);
    await this.backend.put(storageId, await encryptVaultObject(this.key, storageId, kind, payload), revision);
  }
  private async readApp(id: string, stored?: StoredObject): Promise<Decoded<VaultApp>> {
    const decoded = await this.read("app", id, stored, isApp);
    if (decoded.value.vaultId !== this.vaultId || decoded.value.id !== id) throw new VaultFormatError();
    return decoded;
  }
  private async readAccount(id: string, stored?: StoredObject): Promise<Decoded<VaultAccount>> {
    const decoded = await this.read("account", id, stored, isAccount);
    if (decoded.value.vaultId !== this.vaultId || decoded.value.id !== id) throw new VaultFormatError();
    return decoded;
  }
  private async readCredential(id: string, allowMissing = false): Promise<Decoded<VaultCredential> | null> {
    const object = await this.backend.get(objectId("credential", id));
    if (!object) { if (allowMissing) return null; throw new Error("该账号没有可用凭据"); }
    const decoded = await this.decode<VaultCredential>(object, "credential");
    if (!isCredential(decoded.payload)) throw new VaultFormatError();
    return { value: decoded.payload, stored: object };
  }
  private async read<T>(kind: "app" | "account", id: string, stored: StoredObject | undefined, validator: (value: unknown) => value is T): Promise<Decoded<T>> {
    const object = stored?.data ? stored : await this.backend.get(objectId(kind, id));
    if (!object) throw new Error(kind === "app" ? "应用不存在" : "账号不存在");
    const decoded = await this.decode<T>(object, kind);
    if (!validator(decoded.payload)) throw new VaultFormatError();
    return { value: decoded.payload, stored: object };
  }
  private async decode<T>(object: StoredObject, kind: "manifest" | "app" | "account" | "credential"): Promise<{ payload: T }> {
    const decoded = await decryptVaultObject<T>(this.key, object.data);
    if (decoded.envelope.id !== object.id || decoded.envelope.kind !== kind || decoded.envelope.keyVersion !== 1) throw new VaultFormatError();
    return decoded;
  }
}
interface Decoded<T> { value: T; stored: StoredObject; }
function objectId(kind: "app" | "account" | "credential", id: string): string { if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) throw new Error("Vault 对象 ID 无效"); return `${kind}_${id}`; }
function randomId(): string { return crypto.randomUUID().replaceAll("-", ""); }
function validateTargets(targets: VaultTarget[]): VaultTarget[] {
  if (!Array.isArray(targets) || !targets.length) throw new Error("应用至少需要一个 HTTPS 目标");
  return targets.map((target) => { const host = target.host.trim().toLowerCase(); const pathPrefix = target.pathPrefix?.trim().replace(/^\/?/, "/").replace(/\/+$/, "") || undefined; if (target.scheme !== "https" || !/^[a-z0-9.-]+$/.test(host) || host.includes("..") || host.startsWith(".") || host.endsWith(".")) throw new Error("应用目标格式无效"); return { scheme: "https", host, ...(pathPrefix && { pathPrefix }), ...(target.includeSubdomains && { includeSubdomains: true }) }; });
}
function isManifest(value: unknown): value is VaultManifestPayload { const item = value as VaultManifestPayload; return Boolean(item && typeof item.vaultId === "string" && /^[A-Za-z0-9-]{16,160}$/.test(item.vaultId) && item.schemaVersion === 1); }
function isApp(value: unknown): value is VaultApp { const app = value as VaultApp; try { return Boolean(app && typeof app.id === "string" && typeof app.vaultId === "string" && typeof app.name === "string" && validateTargets(app.targets)); } catch { return false; } }
function isAccount(value: unknown): value is VaultAccount { const account = value as VaultAccount; return Boolean(account && typeof account.id === "string" && typeof account.vaultId === "string" && typeof account.appId === "string" && typeof account.username === "string" && typeof account.credentialId === "string"); }
function isCredential(value: unknown): value is VaultCredential { const credential = value as VaultCredential; return Boolean(credential && typeof credential.password === "string" && (credential.deletedAt === undefined || typeof credential.deletedAt === "number")); }
