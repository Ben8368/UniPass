import { credentialForAccount, credentialAvailableForAccount } from "../../shared/api";
import { importVaultKey, exportVaultKey, generateVaultKey } from "../../shared/vault-crypto";
import { normalizeWebDavUrl } from "../../shared/url";
import type { AccountListResult, UniPassAccount } from "../../shared/types";
import { type AccountRef, type VaultAccount, type VaultApp, type VaultConnection, type VaultConnectionState, type VaultCredential, type VaultProfile } from "../../shared/vault";
import { openLocalUnlockMaterial, sealLocalUnlockMaterial, type LocalUnlockEnvelope } from "./local-unlock";
import { WebDavBackend } from "./webdav-backend";
import { VaultCore } from "./vault-core";

const PROFILES_KEY = "unipass-vault-profiles";
const SESSION_SECRETS_KEY = "unipass-vault-session-secrets";
const LOCAL_UNLOCKS_KEY = "unipass-vault-local-unlocks";
const LOCAL_UNLOCK_FAILURES_KEY = "unipass-vault-local-unlock-failures";
const LOCAL_UNLOCK_MAX_FAILURES = 5;
const LEGACY_VAULT_ID = "legacy-unipass";

interface SessionSecret { username: string; appPassword: string; vaultKey: string; }
export interface WebDavVaultInput {
  mode: "create" | "existing" | "reconnect";
  vaultId?: string;
  name: string;
  endpoint: string;
  username: string;
  appPassword: string;
  vaultKey?: string;
}
export interface WebDavVaultCatalogResult { entries: Array<{ app: VaultApp; accounts: VaultAccount[] }>; failures: Array<{ vaultId: string; error: string }>; }

export async function listVaultProfiles(): Promise<VaultProfile[]> { return validateProfiles((await chrome.storage.local.get(PROFILES_KEY))[PROFILES_KEY]); }
export async function listVaultConnectionStates(): Promise<VaultConnectionState[]> {
  const [profiles, secrets] = await Promise.all([listVaultProfiles(), readSecrets()]);
  return profiles.map((profile) => ({ vaultId: profile.id, name: profile.name, connected: hasSessionSecret(secrets[profile.id]) }));
}
export async function testWebDavConnection(input: Omit<WebDavVaultInput, "mode">): Promise<void> {
  await new WebDavBackend(normalizeWebDavUrl(input.endpoint), input.username, input.appPassword).connect();
}

/** Explicit create/open/reconnect state machine; neither unsuccessful open nor a wrong key changes local state. */
export async function saveWebDavVault(input: WebDavVaultInput): Promise<VaultConnection> {
  const endpoint = normalizeWebDavUrl(input.endpoint);
  const name = input.name.trim(); const username = input.username.trim();
  if (!name || !username || !input.appPassword) throw new Error("Vault 名称、用户名和 App Password 不能为空");
  const profiles = await listVaultProfiles();
  const existingProfile = input.vaultId ? profiles.find((profile) => profile.id === input.vaultId) : undefined;
  if (input.mode === "reconnect" && !existingProfile) throw new Error("Vault 不存在");
  if (input.mode !== "reconnect" && input.vaultId) throw new Error("新建或连接已有密码库不能复用本地 Vault ID");
  const backend = new WebDavBackend(endpoint, username, input.appPassword);
  await backend.connect();
  const secrets = await readSecrets();
  let vaultKey: string;
  let core: VaultCore;
  let recoveryKey: string | undefined;
  if (input.mode === "create") {
    vaultKey = await exportVaultKey(await generateVaultKey()); recoveryKey = vaultKey;
    const vaultId = crypto.randomUUID();
    core = await VaultCore.create(vaultId, backend, await importVaultKey(vaultKey));
  } else {
    vaultKey = input.vaultKey?.trim() || secrets[existingProfile?.id ?? ""]?.vaultKey || "";
    if (!vaultKey) throw new Error("请粘贴 Vault Key 后重新连接");
    core = await VaultCore.open(backend, await importVaultKey(vaultKey));
    if (input.mode === "reconnect" && existingProfile && existingProfile.id !== core.vaultId) throw new Error("远端 Vault 与本地连接配置不匹配");
  }
  const profile: VaultProfile = { id: core.vaultId, name, backend: "webdav", enabled: true, endpoint };
  await chrome.storage.local.set({ [PROFILES_KEY]: [...profiles.filter((candidate) => candidate.id !== profile.id), profile] });
  await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: { ...secrets, [profile.id]: { username, appPassword: input.appPassword, vaultKey } satisfies SessionSecret } });
  return { profile, ...(recoveryKey && { recoveryKey }) };
}

/** Local unlock is opt-in. It stores ciphertext only; unlock failures are session-scoped and fail closed. */
export async function enableLocalUnlock(vaultId: string, password: string): Promise<void> {
  const secret = (await readSecrets())[vaultId]; if (!secret) throw new Error("请先连接 Vault 后再启用本地解锁");
  const unlocks = await readUnlocks();
  await chrome.storage.local.set({ [LOCAL_UNLOCKS_KEY]: { ...unlocks, [vaultId]: await sealLocalUnlockMaterial(password, secret) } });
}
export async function unlockVaultLocally(vaultId: string, password: string): Promise<void> {
  const failures = await readFailures(); if ((failures[vaultId] ?? 0) >= LOCAL_UNLOCK_MAX_FAILURES) throw new Error("本地解锁已锁定，请重新连接该 Vault");
  const envelope = (await readUnlocks())[vaultId]; if (!envelope) throw new Error("该 Vault 未启用本地解锁");
  try {
    const material = await openLocalUnlockMaterial(password, envelope);
    const profile = await profileFor(vaultId);
    const core = await VaultCore.open(new WebDavBackend(profile.endpoint!, material.username, material.appPassword), await importVaultKey(material.vaultKey));
    if (core.vaultId !== vaultId) throw new Error("本地解锁材料与 Vault 不匹配");
    const secrets = await readSecrets(); await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: { ...secrets, [vaultId]: material } });
    delete failures[vaultId]; await chrome.storage.session.set({ [LOCAL_UNLOCK_FAILURES_KEY]: failures });
  } catch (error) {
    failures[vaultId] = (failures[vaultId] ?? 0) + 1; await chrome.storage.session.set({ [LOCAL_UNLOCK_FAILURES_KEY]: failures });
    throw error;
  }
}
export async function disableLocalUnlock(vaultId: string): Promise<void> { const unlocks = await readUnlocks(); delete unlocks[vaultId]; await chrome.storage.local.set({ [LOCAL_UNLOCKS_KEY]: unlocks }); }
export async function lockVault(vaultId: string): Promise<void> { const secrets = await readSecrets(); delete secrets[vaultId]; await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: secrets }); }

export async function removeVault(vaultId: string): Promise<void> {
  const profiles = await listVaultProfiles(); const target = profiles.find((profile) => profile.id === vaultId); if (!target) return;
  const remaining = profiles.filter((profile) => profile.id !== vaultId); await chrome.storage.local.set({ [PROFILES_KEY]: remaining });
  await lockVault(vaultId); await disableLocalUnlock(vaultId);
  if (target.endpoint) try { const origin = new URL(target.endpoint).origin; if (!remaining.some((profile) => profile.endpoint && new URL(profile.endpoint).origin === origin)) await chrome.permissions.remove({ origins: [`${origin}/*`] }); } catch { /* permission cleanup is best effort */ }
}
export async function vaultCatalog(): Promise<WebDavVaultCatalogResult> {
  const entries: WebDavVaultCatalogResult["entries"] = []; const failures: WebDavVaultCatalogResult["failures"] = [];
  for (const profile of await listVaultProfiles()) try { const catalog = await coreFor(profile).then((core) => core.catalog()); entries.push(...catalog.apps.map((app) => ({ app, accounts: catalog.accounts.filter((account) => account.appId === app.id) }))); } catch (error) { failures.push({ vaultId: profile.id, error: error instanceof Error ? error.message : "WebDAV Vault 同步失败" }); }
  return { entries, failures };
}
export async function vaultApps(): Promise<VaultApp[]> { return (await vaultCatalog()).entries.map(({ app }) => app); }
export async function vaultAccounts(vaultId: string, appId: string): Promise<AccountListResult> { const catalog = await coreFor(await profileFor(vaultId)).then((core) => core.catalog()); const app = catalog.apps.find((candidate) => candidate.id === appId); if (!app) throw new Error("应用不存在"); return { appUrl: app.targets[0] ? targetToUrl(app.targets[0]) : "", vaultId, accounts: catalog.accounts.filter((account) => account.appId === appId).map(toLegacyAccount) }; }
export async function vaultAppUrl(vaultId: string, appId: string): Promise<string> { const catalog = await coreFor(await profileFor(vaultId)).then((core) => core.catalog()); const app = catalog.apps.find((candidate) => candidate.id === appId); if (!app?.targets[0]) throw new Error("该应用没有可用的登录地址"); return targetToUrl(app.targets[0]); }
export async function credentialForRef(ref: AccountRef): Promise<{ username: string; password: string }> { if (ref.vaultId === LEGACY_VAULT_ID) return credentialForAccount(ref.accountId); return coreFor(await profileFor(ref.vaultId)).then((core) => core.credential(ref)); }
export async function credentialAvailabilityForRef(ref: AccountRef): Promise<"available" | "empty"> { if (ref.vaultId === LEGACY_VAULT_ID) return (await credentialAvailableForAccount(ref.accountId)) ? "available" : "empty"; return coreFor(await profileFor(ref.vaultId)).then((core) => core.credentialAvailability(ref)); }
export async function createVaultApp(vaultId: string, input: Omit<VaultApp, "id" | "vaultId">): Promise<VaultApp> { return coreFor(await profileFor(vaultId)).then((core) => core.createApp(input)); }
export async function updateVaultApp(vaultId: string, app: VaultApp): Promise<VaultApp> { return coreFor(await profileFor(vaultId)).then((core) => core.updateApp(app)); }
export async function deleteVaultApp(vaultId: string, appId: string): Promise<void> { return coreFor(await profileFor(vaultId)).then((core) => core.deleteApp(appId)); }
export async function createVaultAccount(vaultId: string, input: Omit<VaultAccount, "id" | "vaultId" | "credentialId"> & { password: string }): Promise<VaultAccount> { return coreFor(await profileFor(vaultId)).then((core) => core.createAccount(input)); }
export async function updateVaultAccount(vaultId: string, account: VaultAccount): Promise<VaultAccount> { return coreFor(await profileFor(vaultId)).then((core) => core.updateAccount(account)); }
export async function deleteVaultAccount(vaultId: string, accountId: string): Promise<void> { return coreFor(await profileFor(vaultId)).then((core) => core.deleteAccount(accountId)); }
export async function updateVaultCredential(vaultId: string, accountId: string, credential: VaultCredential): Promise<void> { return coreFor(await profileFor(vaultId)).then((core) => core.updateCredential({ vaultId, accountId }, credential)); }

async function coreFor(profile: VaultProfile): Promise<VaultCore> { if (profile.backend !== "webdav" || !profile.endpoint) throw new Error("Vault backend 不受支持"); const secret = (await readSecrets())[profile.id]; if (!secret) throw new Error("WebDAV 凭据未在当前浏览器会话中配置，请重新连接 Vault"); const core = await VaultCore.open(new WebDavBackend(profile.endpoint, secret.username, secret.appPassword), await importVaultKey(secret.vaultKey)); if (core.vaultId !== profile.id) throw new Error("远端 Vault 与本地连接配置不匹配"); return core; }
async function profileFor(vaultId: string): Promise<VaultProfile> { const profile = (await listVaultProfiles()).find((candidate) => candidate.id === vaultId); if (!profile || !profile.enabled) throw new Error("Vault 不存在或已停用"); return profile; }
async function readSecrets(): Promise<Record<string, SessionSecret>> { const value = (await chrome.storage.session.get(SESSION_SECRETS_KEY))[SESSION_SECRETS_KEY]; return isRecord(value) ? value as Record<string, SessionSecret> : {}; }
async function readUnlocks(): Promise<Record<string, LocalUnlockEnvelope>> { const value = (await chrome.storage.local.get(LOCAL_UNLOCKS_KEY))[LOCAL_UNLOCKS_KEY]; return isRecord(value) ? value as Record<string, LocalUnlockEnvelope> : {}; }
async function readFailures(): Promise<Record<string, number>> { const value = (await chrome.storage.session.get(LOCAL_UNLOCK_FAILURES_KEY))[LOCAL_UNLOCK_FAILURES_KEY]; return isRecord(value) ? value as Record<string, number> : {}; }
function validateProfiles(value: unknown): VaultProfile[] { return Array.isArray(value) ? value.filter((candidate): candidate is VaultProfile => { const profile = candidate as VaultProfile; return Boolean(profile && typeof profile.id === "string" && typeof profile.name === "string" && profile.backend === "webdav" && typeof profile.endpoint === "string" && profile.enabled === true); }) : []; }
function toLegacyAccount(account: VaultAccount): UniPassAccount { return { id: account.id, account: account.username, remark: account.remark, vaultId: account.vaultId, appId: account.appId, accountRef: { vaultId: account.vaultId, accountId: account.id } }; }
function targetToUrl(target: VaultApp["targets"][number]): string { return `https://${target.host}${target.pathPrefix || "/"}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function hasSessionSecret(value: SessionSecret | undefined): boolean { return Boolean(value?.username && value.appPassword && value.vaultKey); }
