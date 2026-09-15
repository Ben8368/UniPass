import { credentialForAccount, credentialAvailableForAccount } from "../../shared/api";
import { importVaultKey, exportVaultKey, generateVaultKey } from "../../shared/vault-crypto";
import { normalizeWebDavUrl, webDavPermissionOrigin } from "../../shared/url";
import type { AccountListResult, UniPassAccount } from "../../shared/types";
import { type AccountRef, type VaultAccount, type VaultAccountUpdate, type VaultApp, type VaultConnection, type VaultConnectionState, type VaultCredential, type VaultProfile } from "../../shared/vault";
import { openGlobalPin, openLocalUnlockMaterial, sealGlobalPin, sealLocalUnlockMaterial, validateGlobalPin, type LocalUnlockEnvelope } from "./local-unlock";
import { openPersistentMaterial, sealPersistentMaterial, type PersistentSecretEnvelope } from "./persistent-secrets";
import { WebDavBackend } from "./webdav-backend";
import { VaultCore } from "./vault-core";
import { EncryptedVaultCache } from "./local-cache";
import { VaultSyncEngine, type VaultSyncStatus } from "./sync-engine";
import { importDisplayName, normalizeBrowserPasswordRecord, type BrowserPasswordImportRecord } from "../../shared/import/normalize";

const PROFILES_KEY = "unipass-vault-profiles";
const SESSION_SECRETS_KEY = "unipass-vault-session-secrets";
const LOCAL_UNLOCKS_KEY = "unipass-vault-local-unlocks";
const PERSISTENT_CONNECTIONS_KEY = "unipass-vault-persistent-connections";
const LOCAL_UNLOCK_FAILURES_KEY = "unipass-vault-local-unlock-failures";
const GLOBAL_PIN_KEY = "unipass-global-pin";
const GLOBAL_PIN_FAILURES_KEY = "unipass-global-pin-failures";
const LOCAL_UNLOCK_MAX_FAILURES = 5;
const GLOBAL_PIN_MAX_FAILURES = 5;
const LEGACY_VAULT_ID = "legacy-unipass";
const syncInFlight = new Map<string, Promise<VaultSyncStatus>>();

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
export type BrowserImportDuplicateStrategy = "skip" | "overwrite" | "keep";
export interface BrowserPasswordImportResult {
  added: number;
  skipped: number;
  failed: Array<{ line: number; reason: string }>;
  sync: VaultSyncStatus;
}

export async function listVaultProfiles(): Promise<VaultProfile[]> { return validateProfiles((await chrome.storage.local.get(PROFILES_KEY))[PROFILES_KEY]); }
export async function listVaultConnectionStates(): Promise<VaultConnectionState[]> {
  const [profiles, secrets] = await Promise.all([listVaultProfiles(), readSecrets()]);
  return profiles.map((profile) => ({ vaultId: profile.id, name: profile.name, connected: hasSessionSecret(secrets[profile.id]) }));
}
export async function testWebDavConnection(input: Pick<WebDavVaultInput, "endpoint" | "username" | "appPassword"> & { vaultId?: string }): Promise<void> {
  const material = await connectionMaterial(input.vaultId, input.username, input.appPassword);
  await new WebDavBackend(normalizeWebDavUrl(input.endpoint), material.username, material.appPassword).connect();
}

export async function requestWebDavPermission(endpoint: string): Promise<void> {
  const granted = await chrome.permissions.request({ origins: [webDavPermissionOrigin(endpoint)] });
  if (!granted) throw new Error("未授予 WebDAV 主机权限，已取消操作");
}

export async function releaseUnusedWebDavPermission(endpoint: string): Promise<void> {
  try {
    await releaseWebDavPermissionIfUnused(endpoint, await listVaultProfiles());
  } catch {
    // Permission cleanup is best effort and must not mask the requested operation.
  }
}

/** Explicit create/open/reconnect state machine; neither unsuccessful open nor a wrong key changes local state. */
export async function saveWebDavVault(input: WebDavVaultInput): Promise<VaultConnection> {
  const endpoint = normalizeWebDavUrl(input.endpoint);
  const name = input.name.trim(); const username = input.username.trim();
  const secrets = await readSecrets();
  const profiles = await listVaultProfiles();
  const existingProfile = input.vaultId ? profiles.find((profile) => profile.id === input.vaultId) : undefined;
  if (input.mode === "reconnect" && !existingProfile) throw new Error("Vault 不存在");
  if (input.mode !== "reconnect" && input.vaultId) throw new Error("新建或连接已有密码库不能复用本地 Vault ID");
  const previous = existingProfile ? secrets[existingProfile.id] : undefined;
  const resolvedUsername = username || previous?.username || "";
  const resolvedAppPassword = input.appPassword || previous?.appPassword || "";
  if (!name || !resolvedUsername || !resolvedAppPassword) throw new Error("Vault 名称、用户名和 App Password 不能为空");
  const backend = new WebDavBackend(endpoint, resolvedUsername, resolvedAppPassword);
  await backend.connect();
  let vaultKey: string;
  let core: VaultCore;
  let recoveryKey: string | undefined;
  if (input.mode === "create") {
    vaultKey = await exportVaultKey(await generateVaultKey()); recoveryKey = vaultKey;
    const vaultId = crypto.randomUUID();
    core = await VaultCore.create(vaultId, backend, await importVaultKey(vaultKey));
  } else {
    vaultKey = input.vaultKey?.trim() || previous?.vaultKey || "";
    if (!vaultKey) throw new Error("请粘贴 Vault Key 后重新连接");
    core = await VaultCore.open(backend, await importVaultKey(vaultKey));
    if (input.mode === "reconnect" && existingProfile && profiles.some((profile) => profile.id === core.vaultId && profile.id !== existingProfile.id)) throw new Error("远端 Vault 已对应另一个本地密码库");
  }
  const profile: VaultProfile = { id: core.vaultId, name, backend: "webdav", enabled: true, endpoint };
  const nextProfiles = profiles.filter((candidate) => candidate.id !== profile.id && candidate.id !== existingProfile?.id);
  const material = { username: resolvedUsername, appPassword: resolvedAppPassword, vaultKey };
  const persistent = await readPersistentEnvelopes();
  if (existingProfile && existingProfile.id !== profile.id) delete persistent[existingProfile.id];
  persistent[profile.id] = await sealPersistentMaterial(material);
  // Profiles and their durable connection material describe one local state.
  // chrome.storage.local is not a database transaction, but one set minimizes
  // observable half-written states and gives failures a single recovery point.
  await chrome.storage.local.set({
    [PROFILES_KEY]: [...nextProfiles, profile],
    [PERSISTENT_CONNECTIONS_KEY]: persistent,
  });
  if (existingProfile?.endpoint && webDavPermissionOrigin(existingProfile.endpoint) !== webDavPermissionOrigin(endpoint)) {
    await releaseWebDavPermissionIfUnused(existingProfile.endpoint, [...nextProfiles, profile]);
  }
  const nextSecrets = { ...secrets };
  if (existingProfile && existingProfile.id !== profile.id) delete nextSecrets[existingProfile.id];
  nextSecrets[profile.id] = material satisfies SessionSecret;
  await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: nextSecrets });
  // Cache population is local and best effort here: the remote Vault and its
  // connection state are already committed, so a cache failure remains
  // recoverable through the existing online path on the next read.
  try { await new VaultSyncEngine(new EncryptedVaultCache(core.vaultId), backend).synchronize(); } catch { /* reconnect remains available */ }
  return { profile, ...(recoveryKey && { recoveryKey }) };
}

/** Legacy local-unlock messages remain supported for profiles created by older builds. */
export async function enableLocalUnlock(vaultId: string, password: string): Promise<void> {
  const secret = (await readSecrets())[vaultId]; if (!secret) throw new Error("请先连接 Vault 后再启用本地解锁");
  await ensureGlobalPin(password);
  const unlocks = await readUnlocks();
  await chrome.storage.local.set({ [LOCAL_UNLOCKS_KEY]: { ...unlocks, [vaultId]: await sealLocalUnlockMaterial(password, secret) } });
}
export async function unlockVaultLocally(vaultId: string, password: string): Promise<void> {
  const failures = await readFailures(); if ((failures[vaultId] ?? 0) >= LOCAL_UNLOCK_MAX_FAILURES) throw new Error("本地解锁已锁定，请重新连接该 Vault");
  const envelope = (await readUnlocks())[vaultId]; if (!envelope) throw new Error("该 Vault 未启用本地解锁");
  try {
    if (await readGlobalPinEnvelope()) await verifyGlobalPin(password);
    const material = await openLocalUnlockMaterial(password, envelope);
    const profile = await profileFor(vaultId);
    const core = await VaultCore.open(new WebDavBackend(profile.endpoint!, material.username, material.appPassword), await importVaultKey(material.vaultKey));
    if (!(await readGlobalPinEnvelope())) await setGlobalPin(password);
    let resolvedId = vaultId;
    const profiles = await listVaultProfiles();
    const unlocks = await readUnlocks(); delete unlocks[vaultId];
    const persistent = await readPersistentEnvelopes(); delete persistent[vaultId];
    let nextProfiles = profiles;
    if (core.vaultId !== vaultId) {
      if (profiles.some((candidate) => candidate.id === core.vaultId && candidate.id !== vaultId)) throw new Error("远端 Vault 已对应另一个本地密码库");
      resolvedId = core.vaultId;
      nextProfiles = [...profiles.filter((candidate) => candidate.id !== vaultId && candidate.id !== resolvedId), { ...profile, id: resolvedId }];
    }
    unlocks[resolvedId] = await sealLocalUnlockMaterial(password, material);
    persistent[resolvedId] = await sealPersistentMaterial(material);
    await chrome.storage.local.set({
      ...(core.vaultId !== vaultId && { [PROFILES_KEY]: nextProfiles }),
      [LOCAL_UNLOCKS_KEY]: unlocks,
      [PERSISTENT_CONNECTIONS_KEY]: persistent,
    });
    const secrets = await readSecrets(); delete secrets[vaultId]; secrets[resolvedId] = material; await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: secrets });
    delete failures[vaultId]; await chrome.storage.session.set({ [LOCAL_UNLOCK_FAILURES_KEY]: failures });
  } catch (error) {
    failures[vaultId] = (failures[vaultId] ?? 0) + 1; await chrome.storage.session.set({ [LOCAL_UNLOCK_FAILURES_KEY]: failures });
    throw error;
  }
}
export async function disableLocalUnlock(vaultId: string): Promise<void> { const unlocks = await readUnlocks(); delete unlocks[vaultId]; await chrome.storage.local.set({ [LOCAL_UNLOCKS_KEY]: unlocks }); }
export async function lockVault(vaultId: string): Promise<void> { const secrets = await readSecrets(); delete secrets[vaultId]; await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: secrets }); }

export async function setGlobalPin(pin: string): Promise<void> {
  validateGlobalPin(pin);
  if (await readGlobalPinEnvelope()) { await verifyGlobalPin(pin); return; }
  await chrome.storage.local.set({ [GLOBAL_PIN_KEY]: await sealGlobalPin(pin) });
}

export async function verifyGlobalPin(pin: string): Promise<void> {
  validateGlobalPin(pin);
  const failures = await readGlobalPinFailures();
  if (failures >= GLOBAL_PIN_MAX_FAILURES) throw new Error("全局 PIN 已锁定，请重新连接密码库");
  const envelope = await readGlobalPinEnvelope();
  if (!envelope) throw new Error("尚未设置全局 PIN，请先设置后再查看账号密码或使用高级功能");
  try {
    await openGlobalPin(pin, envelope);
    await chrome.storage.session.set({ [GLOBAL_PIN_FAILURES_KEY]: 0 });
  } catch {
    await chrome.storage.session.set({ [GLOBAL_PIN_FAILURES_KEY]: failures + 1 });
    throw new Error("全局 PIN 错误");
  }
}

export async function removeVault(vaultId: string): Promise<void> {
  const profiles = await listVaultProfiles(); const target = profiles.find((profile) => profile.id === vaultId); if (!target) return;
  const remaining = profiles.filter((profile) => profile.id !== vaultId);
  const unlocks = await readUnlocks(); delete unlocks[vaultId];
  const persistent = await readPersistentEnvelopes(); delete persistent[vaultId];
  // Keep local profile, legacy unlock material, and durable connection material
  // in one local write so deletion cannot leave an apparently usable orphan.
  await chrome.storage.local.set({
    [PROFILES_KEY]: remaining,
    [LOCAL_UNLOCKS_KEY]: unlocks,
    [PERSISTENT_CONNECTIONS_KEY]: persistent,
  });
  const secrets = await readSecrets(); delete secrets[vaultId];
  await chrome.storage.session.set({ [SESSION_SECRETS_KEY]: secrets });
  try { await new EncryptedVaultCache(vaultId).clear(); } catch { /* cache cleanup is best effort after local removal */ }
  if (target.endpoint) await releaseWebDavPermissionIfUnused(target.endpoint, remaining);
}
export async function vaultCatalog(): Promise<WebDavVaultCatalogResult> {
  const entries: WebDavVaultCatalogResult["entries"] = []; const failures: WebDavVaultCatalogResult["failures"] = [];
  for (const profile of await listVaultProfiles()) try { const catalog = await coreFor(profile).then((core) => core.catalog()); entries.push(...catalog.apps.map((app) => ({ app, accounts: catalog.accounts.filter((account) => account.appId === app.id) }))); void syncProfile(profile).catch(() => {}); } catch (error) { failures.push({ vaultId: profile.id, error: error instanceof Error ? error.message : "WebDAV Vault cache unavailable" }); }
  return { entries, failures };
}
export async function vaultApps(): Promise<VaultApp[]> { return (await vaultCatalog()).entries.map(({ app }) => app); }
export async function vaultAccounts(vaultId: string, appId: string): Promise<AccountListResult> { const catalog = await coreFor(await profileFor(vaultId)).then((core) => core.catalog()); const app = catalog.apps.find((candidate) => candidate.id === appId); if (!app) throw new Error("应用不存在"); return { appUrl: app.targets[0] ? targetToUrl(app.targets[0]) : "", vaultId, accounts: catalog.accounts.filter((account) => account.appId === appId).map(toLegacyAccount) }; }
export async function vaultAppUrl(vaultId: string, appId: string): Promise<string> { const catalog = await coreFor(await profileFor(vaultId)).then((core) => core.catalog()); const app = catalog.apps.find((candidate) => candidate.id === appId); if (!app?.targets[0]) throw new Error("该应用没有可用的登录地址"); return targetToUrl(app.targets[0]); }
export async function credentialForRef(ref: AccountRef): Promise<{ username: string; password: string }> { if (ref.vaultId === LEGACY_VAULT_ID) return credentialForAccount(ref.accountId); return coreFor(await profileFor(ref.vaultId)).then((core) => core.credential(ref)); }
export async function credentialAvailabilityForRef(ref: AccountRef): Promise<"available" | "empty"> { if (ref.vaultId === LEGACY_VAULT_ID) return (await credentialAvailableForAccount(ref.accountId)) ? "available" : "empty"; return coreFor(await profileFor(ref.vaultId)).then((core) => core.credentialAvailability(ref)); }
export async function createVaultApp(vaultId: string, input: Omit<VaultApp, "id" | "vaultId">): Promise<VaultApp> { return localWrite(vaultId, (core) => core.createApp(input)); }
export async function updateVaultApp(vaultId: string, app: VaultApp): Promise<VaultApp> { return localWrite(vaultId, (core) => core.updateApp(app)); }
export async function deleteVaultApp(vaultId: string, appId: string): Promise<void> { return localWrite(vaultId, (core) => core.deleteApp(appId)); }
export async function createVaultAccount(vaultId: string, input: Omit<VaultAccount, "id" | "vaultId" | "credentialId"> & { password: string }): Promise<VaultAccount> { return localWrite(vaultId, (core) => core.createAccount(input)); }
export async function updateVaultAccount(vaultId: string, account: VaultAccountUpdate): Promise<VaultAccount> { return localWrite(vaultId, (core) => core.updateAccount(account)); }
export async function deleteVaultAccount(vaultId: string, accountId: string): Promise<void> { return localWrite(vaultId, (core) => core.deleteAccount(accountId)); }
export async function updateVaultCredential(vaultId: string, accountId: string, credential: VaultCredential): Promise<void> { return localWrite(vaultId, (core) => core.updateCredential({ vaultId, accountId }, credential)); }

export async function importBrowserPasswords(vaultId: string, records: BrowserPasswordImportRecord[], strategy: BrowserImportDuplicateStrategy): Promise<BrowserPasswordImportResult> {
  const profile = await profileFor(vaultId);
  const core = await coreFor(profile);
  const result = await applyBrowserPasswordImport(vaultId, core, records, strategy);
  result.sync = await syncProfile(profile);
  return result;
}

export async function applyBrowserPasswordImport(vaultId: string, core: Pick<VaultCore, "catalog" | "createApp" | "createAccount" | "updateCredential">, records: BrowserPasswordImportRecord[], strategy: BrowserImportDuplicateStrategy): Promise<BrowserPasswordImportResult> {
  const catalog = await core.catalog();
  const apps = [...catalog.apps];
  const accounts = [...catalog.accounts];
  const result: BrowserPasswordImportResult = { added: 0, skipped: 0, failed: [], sync: { state: "pending", dirty: 0, conflicts: 0 } };
  for (const source of records) {
    const record = normalizeBrowserPasswordRecord(source, typeof (source as BrowserPasswordImportRecord & { line?: unknown }).line === "number" ? (source as BrowserPasswordImportRecord & { line: number }).line : 0);
    if (!record) { result.failed.push({ line: 0, reason: "URL is invalid" }); continue; }
    try {
      let app = apps.find((candidate) => candidate.targets.some((target) => sameTarget(target, record.target)));
      if (!app) {
        app = await core.createApp({ name: importDisplayName(record), targets: [record.target] });
        apps.push(app);
      }
      const duplicate = accounts.find((account) => account.appId === app!.id && account.username === record.username);
      if (duplicate) {
        if (strategy === "skip") { result.skipped += 1; continue; }
        if (strategy === "overwrite") { await core.updateCredential({ vaultId, accountId: duplicate.id }, { password: record.password }); result.added += 1; continue; }
      }
      const account = await core.createAccount({ appId: app.id, username: record.username, password: record.password });
      accounts.push(account);
      result.added += 1;
    } catch (error) {
      result.failed.push({ line: record.line, reason: error instanceof Error && error.message ? "Vault record could not be written" : "Import failed" });
    } finally {
      source.password = "";
      record.password = "";
    }
  }
  return result;
}
export async function listVaultSyncStatuses(): Promise<Array<VaultSyncStatus & { vaultId: string }>> {
  return Promise.all((await listVaultProfiles()).map(async (profile) => ({ vaultId: profile.id, ...await new VaultSyncEngine(new EncryptedVaultCache(profile.id), offlineBackend()).status() })));
}

export async function previewBrowserPasswords(vaultId: string, records: BrowserPasswordImportRecord[]): Promise<{ valid: number; duplicate: number; invalid: number }> {
  const catalog = await coreFor(await profileFor(vaultId)).then((core) => core.catalog());
  let valid = 0; let duplicate = 0; let invalid = 0;
  for (const source of records) {
    const record = normalizeBrowserPasswordRecord(source);
    if (!record) { invalid += 1; continue; }
    const app = catalog.apps.find((candidate) => candidate.targets.some((target) => sameTarget(target, record.target)));
    if (app && catalog.accounts.some((account) => account.appId === app.id && account.username === record.username)) duplicate += 1;
    else valid += 1;
  }
  return { valid, duplicate, invalid };
}

export async function syncAllVaults(): Promise<void> {
  for (const profile of await listVaultProfiles()) await syncProfile(profile).catch(() => {});
}

async function coreFor(profile: VaultProfile): Promise<VaultCore> {
  if (profile.backend !== "webdav" || !profile.endpoint) throw new Error("Vault backend is unsupported");
  const secret = (await readSecrets())[profile.id]; if (!secret) throw new Error("WebDAV connection material is unavailable; reconnect the Vault");
  const cache = new EncryptedVaultCache(profile.id);
  if (!await cache.getManifest()) {
    const remote = new WebDavBackend(profile.endpoint, secret.username, secret.appPassword);
    await remote.connect();
    await new VaultSyncEngine(cache, remote).pull();
  }
  const core = await VaultCore.open(cache, await importVaultKey(secret.vaultKey));
  if (core.vaultId !== profile.id) throw new Error("Remote Vault does not match the local connection profile");
  return core;
}
async function syncProfile(profile: VaultProfile): Promise<VaultSyncStatus> {
  const active = syncInFlight.get(profile.id);
  if (active) return active;
  const task = runSyncProfile(profile).finally(() => syncInFlight.delete(profile.id));
  syncInFlight.set(profile.id, task);
  return task;
}
async function runSyncProfile(profile: VaultProfile): Promise<VaultSyncStatus> {
  const secret = (await readSecrets())[profile.id];
  if (!secret || !profile.endpoint) return { state: "offline", dirty: 0, conflicts: 0 };
  const result = await new VaultSyncEngine(new EncryptedVaultCache(profile.id), new WebDavBackend(profile.endpoint, secret.username, secret.appPassword)).synchronize();
  return { state: result.state, dirty: result.dirty, conflicts: result.conflicts };
}
async function localWrite<T>(vaultId: string, operation: (core: VaultCore) => Promise<T>): Promise<T> {
  const profile = await profileFor(vaultId);
  const result = await operation(await coreFor(profile));
  void syncProfile(profile).catch(() => {});
  return result;
}
function sameTarget(left: VaultApp["targets"][number] | undefined, right: VaultApp["targets"][number]): boolean { return Boolean(left && left.scheme === right.scheme && left.host === right.host && (left.pathPrefix || "/") === (right.pathPrefix || "/")); }
function offlineBackend(): import("../../shared/vault").VaultBackend { return { async connect() {}, async getManifest() { return null; }, async list() { return []; }, async get() { return null; }, async put() { throw new Error("offline"); }, async delete() { throw new Error("offline"); } }; }
async function profileFor(vaultId: string): Promise<VaultProfile> { const profile = (await listVaultProfiles()).find((candidate) => candidate.id === vaultId); if (!profile || !profile.enabled) throw new Error("Vault 不存在或已停用"); return profile; }
async function readSecrets(): Promise<Record<string, SessionSecret>> {
  const value = (await chrome.storage.session.get(SESSION_SECRETS_KEY))[SESSION_SECRETS_KEY];
  // An existing session map is authoritative for this browser session. This
  // also makes an explicit lock/removal (an empty map) stick. Only an absent
  // map triggers restoration from durable encrypted material after startup.
  if (isRecord(value)) return value as Record<string, SessionSecret>;
  return readPersistentConnections();
}
async function readUnlocks(): Promise<Record<string, LocalUnlockEnvelope>> { const value = (await chrome.storage.local.get(LOCAL_UNLOCKS_KEY))[LOCAL_UNLOCKS_KEY]; return isRecord(value) ? value as Record<string, LocalUnlockEnvelope> : {}; }
async function readPersistentConnections(): Promise<Record<string, SessionSecret>> {
  const value = await readPersistentEnvelopes();
  if (!Object.keys(value).length) return {};
  const entries = await Promise.all(Object.entries(value).map(async ([vaultId, envelope]) => {
    try { return [vaultId, await openPersistentMaterial(envelope)] as const; } catch { return null; }
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, SessionSecret] => Boolean(entry)));
}
async function readPersistentEnvelopes(): Promise<Record<string, PersistentSecretEnvelope>> {
  const value = (await chrome.storage.local.get(PERSISTENT_CONNECTIONS_KEY))[PERSISTENT_CONNECTIONS_KEY];
  if (!isRecord(value)) return {};
  return value as Record<string, PersistentSecretEnvelope>;
}
async function readFailures(): Promise<Record<string, number>> { const value = (await chrome.storage.session.get(LOCAL_UNLOCK_FAILURES_KEY))[LOCAL_UNLOCK_FAILURES_KEY]; return isRecord(value) ? value as Record<string, number> : {}; }
function validateProfiles(value: unknown): VaultProfile[] { return Array.isArray(value) ? value.filter((candidate): candidate is VaultProfile => { const profile = candidate as VaultProfile; return Boolean(profile && typeof profile.id === "string" && typeof profile.name === "string" && profile.backend === "webdav" && typeof profile.endpoint === "string" && profile.enabled === true); }) : []; }
function toLegacyAccount(account: VaultAccount): UniPassAccount { return { id: account.id, account: account.username, remark: account.remark, vaultId: account.vaultId, appId: account.appId, accountRef: { vaultId: account.vaultId, accountId: account.id } }; }
function targetToUrl(target: VaultApp["targets"][number]): string { return `https://${target.host}${target.pathPrefix || "/"}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function hasSessionSecret(value: SessionSecret | undefined): boolean { return Boolean(value?.username && value.appPassword && value.vaultKey); }

async function ensureGlobalPin(pin: string): Promise<void> { validateGlobalPin(pin); if (await readGlobalPinEnvelope()) await verifyGlobalPin(pin); else await setGlobalPin(pin); }
async function connectionMaterial(vaultId: string | undefined, username: string, appPassword: string): Promise<SessionSecret> {
  const saved = vaultId ? (await readSecrets())[vaultId] : undefined;
  const material = { username: username.trim() || saved?.username || "", appPassword: appPassword || saved?.appPassword || "", vaultKey: saved?.vaultKey || "" };
  if (!material.username || !material.appPassword) throw new Error("请填写 WebDAV 用户名和 App Password");
  return material;
}
async function releaseWebDavPermissionIfUnused(endpoint: string, profiles: VaultProfile[]): Promise<void> {
  try {
    const origin = webDavPermissionOrigin(endpoint);
    const inUse = profiles.some((profile) => profile.endpoint && webDavPermissionOrigin(profile.endpoint) === origin);
    if (!inUse) await chrome.permissions.remove({ origins: [origin] });
  } catch {
    // Permission cleanup is best effort and must not roll back committed Vault state.
  }
}
async function readGlobalPinEnvelope(): Promise<LocalUnlockEnvelope | undefined> { const value = (await chrome.storage.local.get(GLOBAL_PIN_KEY))[GLOBAL_PIN_KEY]; return isRecord(value) ? value as unknown as LocalUnlockEnvelope : undefined; }
async function readGlobalPinFailures(): Promise<number> { const value = (await chrome.storage.session.get(GLOBAL_PIN_FAILURES_KEY))[GLOBAL_PIN_FAILURES_KEY]; return typeof value === "number" ? value : 0; }
