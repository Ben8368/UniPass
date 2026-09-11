import { credentialForAccount, credentialAvailableForAccount } from "../../shared/api";
import { importVaultKey, exportVaultKey, generateVaultKey } from "../../shared/vault-crypto";
import { normalizeWebDavUrl } from "../../shared/url";
import type { AccountListResult, UniPassAccount } from "../../shared/types";
import type { AccountRef, VaultAccount, VaultApp, VaultCatalog, VaultCredential, VaultProfile } from "../../shared/vault";
import { WebDavBackend } from "./webdav-backend";
import { VaultCore } from "./vault-core";

const PROFILES_KEY = "unipass-vault-profiles";
const SESSION_SECRETS_KEY = "unipass-vault-session-secrets";
const LEGACY_VAULT_ID = "legacy-unipass";

interface SessionSecret {
  username: string;
  appPassword: string;
  vaultKey: string;
}

export interface WebDavVaultInput {
  vaultId?: string;
  name: string;
  endpoint: string;
  username: string;
  appPassword: string;
}

export interface WebDavVaultCatalogResult {
  entries: Array<{ app: VaultApp; accounts: VaultAccount[] }>;
  failures: Array<{ vaultId: string; error: string }>;
}

export async function listVaultProfiles(): Promise<VaultProfile[]> {
  const stored = await chrome.storage.local.get(PROFILES_KEY);
  return validateProfiles(stored[PROFILES_KEY]);
}

export async function testWebDavConnection(input: WebDavVaultInput): Promise<void> {
  const endpoint = normalizeWebDavUrl(input.endpoint);
  const backend = new WebDavBackend(endpoint, input.username, input.appPassword);
  await backend.connect();
}

export async function saveWebDavVault(input: WebDavVaultInput): Promise<VaultProfile> {
  const endpoint = normalizeWebDavUrl(input.endpoint);
  const name = input.name.trim();
  const username = input.username.trim();
  if (!name || !username || !input.appPassword) throw new Error("Vault 名称、用户名和 App Password 不能为空");
  await testWebDavConnection({ ...input, endpoint, username });

  const profiles = await listVaultProfiles();
  const existing = input.vaultId ? profiles.find((profile) => profile.id === input.vaultId) : undefined;
  if (input.vaultId && !existing) throw new Error("Vault 不存在");
  const vaultId = existing?.id ?? crypto.randomUUID();
  const secrets = await readSecrets();
  let vaultKey = existing ? secrets[vaultId]?.vaultKey : undefined;
  if (existing && !vaultKey) throw new Error("当前浏览器会话缺少 Vault Key，请重新添加 Vault");
  if (!vaultKey) vaultKey = await exportVaultKey(await generateVaultKey());
  const profile: VaultProfile = { id: vaultId, name, backend: "webdav", enabled: true, endpoint };
  const core = new VaultCore(vaultId, new WebDavBackend(endpoint, username, input.appPassword), await importVaultKey(vaultKey));
  await core.initialize();
  await chrome.storage.local.set({ [PROFILES_KEY]: [...profiles.filter((candidate) => candidate.id !== vaultId), profile] });
  await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: { ...secrets, [vaultId]: { username, appPassword: input.appPassword, vaultKey } satisfies SessionSecret } });
  return profile;
}

export async function removeVault(vaultId: string): Promise<void> {
  const profiles = await listVaultProfiles();
  const target = profiles.find((profile) => profile.id === vaultId);
  if (!target) return;
  const remaining = profiles.filter((profile) => profile.id !== vaultId);
  await chrome.storage.local.set({ [PROFILES_KEY]: remaining });
  const secrets = await readSecrets();
  delete secrets[vaultId];
  await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: secrets });
  if (target.endpoint) {
    try {
      const origin = new URL(target.endpoint).origin;
      const stillUsed = remaining.some((profile) => profile.endpoint && new URL(profile.endpoint).origin === origin);
      if (!stillUsed) await chrome.permissions.remove({ origins: [`${origin}/*`] });
    } catch { /* permission cleanup is best effort */ }
  }
}

export async function vaultCatalog(): Promise<WebDavVaultCatalogResult> {
  const entries: WebDavVaultCatalogResult["entries"] = [];
  const failures: WebDavVaultCatalogResult["failures"] = [];
  for (const profile of await listVaultProfiles()) {
    try {
      const catalog = await coreFor(profile).then((core) => core.catalog());
      entries.push(...catalog.apps.map((app) => ({ app, accounts: catalog.accounts.filter((account) => account.appId === app.id) })));
    } catch (error) {
      failures.push({ vaultId: profile.id, error: error instanceof Error ? error.message : "WebDAV Vault 同步失败" });
    }
  }
  return { entries, failures };
}

export async function vaultApps(): Promise<VaultApp[]> {
  const result = await vaultCatalog();
  return result.entries.map(({ app }) => app);
}

export async function vaultAccounts(vaultId: string, appId: string): Promise<AccountListResult> {
  const profile = await profileFor(vaultId);
  const catalog = await coreFor(profile).then((core) => core.catalog());
  const app = catalog.apps.find((candidate) => candidate.id === appId);
  if (!app) throw new Error("应用不存在");
  return { appUrl: app.targets[0] ? targetToUrl(app.targets[0]) : "", vaultId, accounts: catalog.accounts.filter((account) => account.appId === appId).map(toLegacyAccount) };
}

export async function vaultAppUrl(vaultId: string, appId: string): Promise<string> {
  const profile = await profileFor(vaultId);
  const catalog = await coreFor(profile).then((core) => core.catalog());
  const app = catalog.apps.find((candidate) => candidate.id === appId);
  if (!app?.targets[0]) throw new Error("该应用没有可用的登录地址");
  return targetToUrl(app.targets[0]);
}

export async function credentialForRef(ref: AccountRef): Promise<{ username: string; password: string }> {
  if (ref.vaultId === LEGACY_VAULT_ID) return credentialForAccount(ref.accountId);
  const profile = await profileFor(ref.vaultId);
  return coreFor(profile).then((core) => core.credential(ref));
}

export async function credentialAvailableForRef(ref: AccountRef): Promise<boolean> {
  if (ref.vaultId === LEGACY_VAULT_ID) return credentialAvailableForAccount(ref.accountId);
  let credential: VaultCredential | null = null;
  try {
    credential = await credentialForRef(ref);
    return Boolean(credential.password);
  } catch {
    return false;
  } finally {
    if (credential) { credential.username = ""; credential.password = ""; }
  }
}

export async function createVaultApp(vaultId: string, input: Omit<VaultApp, "id" | "vaultId">): Promise<VaultApp> {
  return coreFor(await profileFor(vaultId)).then((core) => core.createApp(input));
}

export async function updateVaultApp(vaultId: string, app: VaultApp): Promise<VaultApp> {
  return coreFor(await profileFor(vaultId)).then((core) => core.updateApp(app));
}

export async function deleteVaultApp(vaultId: string, appId: string): Promise<void> {
  return coreFor(await profileFor(vaultId)).then((core) => core.deleteApp(appId));
}

export async function createVaultAccount(vaultId: string, input: Omit<VaultAccount, "id" | "vaultId" | "credentialId"> & { password: string }): Promise<VaultAccount> {
  return coreFor(await profileFor(vaultId)).then((core) => core.createAccount(input));
}

export async function updateVaultAccount(vaultId: string, account: VaultAccount): Promise<VaultAccount> {
  return coreFor(await profileFor(vaultId)).then((core) => core.updateAccount(account));
}

export async function deleteVaultAccount(vaultId: string, accountId: string): Promise<void> {
  return coreFor(await profileFor(vaultId)).then((core) => core.deleteAccount(accountId));
}

export async function updateVaultCredential(vaultId: string, accountId: string, credential: VaultCredential): Promise<void> {
  return coreFor(await profileFor(vaultId)).then((core) => core.updateCredential({ vaultId, accountId }, credential));
}

async function coreFor(profile: VaultProfile): Promise<VaultCore> {
  if (profile.backend !== "webdav" || !profile.endpoint) throw new Error("Vault backend 不受支持");
  const secret = (await readSecrets())[profile.id];
  if (!secret) throw new Error("WebDAV 凭据未在当前浏览器会话中配置，请重新连接 Vault");
  const core = new VaultCore(profile.id, new WebDavBackend(profile.endpoint, secret.username, secret.appPassword), await importVaultKey(secret.vaultKey));
  await core.initialize();
  return core;
}

async function profileFor(vaultId: string): Promise<VaultProfile> {
  const profile = (await listVaultProfiles()).find((candidate) => candidate.id === vaultId);
  if (!profile || !profile.enabled) throw new Error("Vault 不存在或已停用");
  return profile;
}

async function readSecrets(): Promise<Record<string, SessionSecret>> {
  const stored = await chrome.storage.session.get(SESSION_SECRETS_KEY);
  return isRecord(stored[SESSION_SECRETS_KEY]) ? stored[SESSION_SECRETS_KEY] as Record<string, SessionSecret> : {};
}

function validateProfiles(value: unknown): VaultProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is VaultProfile => {
    const profile = candidate as VaultProfile;
    return Boolean(profile && typeof profile.id === "string" && typeof profile.name === "string" && profile.backend === "webdav" && typeof profile.endpoint === "string" && profile.enabled === true);
  });
}

function toLegacyAccount(account: VaultAccount): UniPassAccount {
  return { id: account.id, account: account.username, remark: account.remark, vaultId: account.vaultId, appId: account.appId, accountRef: { vaultId: account.vaultId, accountId: account.id } };
}

function targetToUrl(target: VaultApp["targets"][number]): string {
  return `https://${target.host}${target.pathPrefix || "/"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
