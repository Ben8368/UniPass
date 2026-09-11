import { decryptVaultObject, encryptVaultObject } from "../../shared/vault-crypto";
import {
  VaultFormatError,
  type AccountRef,
  type StoredObject,
  type VaultAccount,
  type VaultApp,
  type VaultBackend,
  type VaultCatalog,
  type VaultCredential,
  type VaultTarget,
} from "../../shared/vault";

const MANIFEST_ID = "manifest";

export class VaultCore {
  constructor(
    readonly vaultId: string,
    private readonly backend: VaultBackend,
    private readonly key: CryptoKey,
  ) {}

  async initialize(): Promise<void> {
    const manifest = await this.backend.getManifest();
    if (manifest) {
      const decoded = await this.decode<{ vaultId: string; schemaVersion: number }>(manifest, "manifest");
      if (decoded.payload.vaultId !== this.vaultId || decoded.payload.schemaVersion !== 1) throw new VaultFormatError();
      return;
    }
    const data = await encryptVaultObject(this.key, MANIFEST_ID, "manifest", { vaultId: this.vaultId, schemaVersion: 1 });
    await this.backend.put(MANIFEST_ID, data);
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
    return {
      apps: apps.filter((app) => !app.deletedAt),
      accounts: accounts.filter((account) => !account.deletedAt),
    };
  }

  async credential(ref: AccountRef): Promise<VaultCredential> {
    if (ref.vaultId !== this.vaultId) throw new Error("Vault 引用不匹配");
    const account = await this.readAccount(ref.accountId);
    if (account.value.deletedAt) throw new Error("该账号已删除");
    const stored = await this.backend.get(objectId("credential", account.value.credentialId));
    if (!stored) throw new Error("该账号没有可用凭据");
    const { payload } = await this.decode<VaultCredential>(stored, "credential");
    if (!isCredential(payload)) throw new VaultFormatError();
    return { username: payload.username, password: payload.password };
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
    await this.update("app", id, { ...current.value, deletedAt: Date.now() }, current.stored.revision);
  }

  async createAccount(input: Omit<VaultAccount, "id" | "vaultId" | "credentialId"> & { password: string }): Promise<VaultAccount> {
    await this.readApp(input.appId);
    const accountId = randomId();
    const credentialId = randomId();
    const { password, ...accountInput } = input;
    const account: VaultAccount = { ...accountInput, id: accountId, vaultId: this.vaultId, credentialId };
    await this.create("credential", credentialId, { username: input.username, password });
    try {
      await this.create("account", accountId, account);
    } catch (error) {
      throw error;
    }
    return account;
  }

  async updateAccount(account: VaultAccount): Promise<VaultAccount> {
    const current = await this.readAccount(account.id);
    await this.readApp(account.appId);
    const next = { ...account, vaultId: this.vaultId, deletedAt: undefined };
    await this.update("account", account.id, next, current.stored.revision);
    return next;
  }

  async deleteAccount(id: string): Promise<void> {
    const current = await this.readAccount(id);
    await this.update("account", id, { ...current.value, deletedAt: Date.now() }, current.stored.revision);
  }

  async updateCredential(ref: AccountRef, credential: VaultCredential): Promise<void> {
    if (ref.vaultId !== this.vaultId || !isCredential(credential)) throw new Error("凭据格式无效");
    const account = await this.readAccount(ref.accountId);
    const object = await this.backend.get(objectId("credential", account.value.credentialId));
    if (!object) throw new Error("该账号没有可用凭据");
    await this.update("credential", account.value.credentialId, credential, object.revision);
  }

  private async create(kind: "app" | "account" | "credential", id: string, payload: unknown): Promise<void> {
    const storageId = objectId(kind, id);
    const data = await encryptVaultObject(this.key, storageId, kind, payload);
    await this.backend.put(storageId, data);
  }

  private async update(kind: "app" | "account" | "credential", id: string, payload: unknown, revision: string): Promise<void> {
    const storageId = objectId(kind, id);
    const data = await encryptVaultObject(this.key, storageId, kind, payload);
    await this.backend.put(storageId, data, revision);
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

function objectId(kind: "app" | "account" | "credential", id: string): string {
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) throw new Error("Vault 对象 ID 无效");
  return `${kind}_${id}`;
}

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function validateTargets(targets: VaultTarget[]): VaultTarget[] {
  if (!Array.isArray(targets) || !targets.length) throw new Error("应用至少需要一个 HTTPS 目标");
  return targets.map((target) => {
    const host = target.host.trim().toLowerCase();
    const pathPrefix = target.pathPrefix?.trim().replace(/^\/?/, "/").replace(/\/+$/, "") || undefined;
    if (target.scheme !== "https" || !/^[a-z0-9.-]+$/.test(host) || host.includes("..") || host.startsWith(".") || host.endsWith(".")) throw new Error("应用目标格式无效");
    return { scheme: "https", host, ...(pathPrefix && { pathPrefix }), ...(target.includeSubdomains && { includeSubdomains: true }) };
  });
}

function isApp(value: unknown): value is VaultApp {
  const app = value as VaultApp;
  try {
    return Boolean(app && typeof app.id === "string" && typeof app.vaultId === "string" && typeof app.name === "string" && validateTargets(app.targets));
  } catch {
    return false;
  }
}

function isAccount(value: unknown): value is VaultAccount {
  const account = value as VaultAccount;
  return Boolean(account && typeof account.id === "string" && typeof account.vaultId === "string" && typeof account.appId === "string" && typeof account.username === "string" && typeof account.credentialId === "string");
}

function isCredential(value: unknown): value is VaultCredential {
  const credential = value as VaultCredential;
  return Boolean(credential && typeof credential.username === "string" && credential.username.length > 0 && typeof credential.password === "string");
}
