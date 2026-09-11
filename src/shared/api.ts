import {
  credentialAvailableCiphertext,
  decryptCredentialCiphertext,
  transformJupiterCredentialCiphertext,
} from "../background/credential-core";
import { normalizeTargetUrl } from "./url";
import { fetchJsonWithTimeout } from "./fetch";
import { RUNTIME_CONFIG_FILE, parseRuntimeConfig, type RuntimeConfig } from "./runtime-config";
import {
  normalizePluginVersion,
  PLUGIN_VERSION_OVERRIDE_STORAGE_KEY,
} from "./plugin-version";
import type {
  AccountCatalogEntry,
  AccountCatalogFailure,
  AccountCatalogResult,
  AccountListResult,
  Credential,
  CurrentUser,
  UniPassAccount,
  UniPassApp,
  PluginVersionSettings,
} from "./types";

const PORTAL_ORIGIN = "https://portal.unipass.top";
const API_ROOT = `${PORTAL_ORIGIN}/api/v1`;
const ACCOUNT_CATALOG_CONCURRENCY = 4;
const APP_LIST_MAX_PAGES = 20;

interface ApiEnvelope<T> {
  success?: boolean;
  result?: T;
  message?: string;
}

interface AppPage {
  list?: UniPassApp[];
  total?: number;
  pages?: number;
  totalPages?: number;
}

interface AccountEnvelope {
  accounts?: UniPassAccount[];
}

interface AppConfig {
  user?: {
    username?: string;
    password?: string;
  };
}


export async function currentUser(): Promise<CurrentUser> {
  const login = await request<boolean>("/login/isLogin");
  if (login !== true) throw new Error("尚未登录 UniPass");
  return (await request<CurrentUser>("/session/current_user")) ?? {};
}

export async function pluginVersionSettings(): Promise<PluginVersionSettings> {
  const override = await readPluginVersionOverride();
  const runtimeConfig = await readRuntimeConfig();
  return {
    localBuildVersion: chrome.runtime.getManifest().version,
    networkVersion: override ?? runtimeConfig.networkPluginVersion,
    storeBaselineVersion: runtimeConfig.networkPluginVersion,
    override: override ?? "",
    source: override ? "manual" : "built-in",
  };
}

export async function setPluginVersionOverride(version: string): Promise<PluginVersionSettings> {
  const requestedVersion = version.trim();
  if (requestedVersion && !normalizePluginVersion(requestedVersion)) {
    throw new Error("网络提交版本必须是三段数字版号，例如 5.4.0");
  }
  if (requestedVersion) await chrome.storage.local.set({ [PLUGIN_VERSION_OVERRIDE_STORAGE_KEY]: requestedVersion });
  else await chrome.storage.local.remove(PLUGIN_VERSION_OVERRIDE_STORAGE_KEY);
  return pluginVersionSettings();
}

export async function accountsForUrl(url: string): Promise<AccountListResult> {
  const normalized = normalizeTargetUrl(url);
  const result = await request<AccountEnvelope>(
    `/app/account/account/list/url?url=${encodeURIComponent(normalized)}`
  );
  return { appUrl: normalized, accounts: validateAccounts(result?.accounts) };
}

export async function accountCatalog(): Promise<AccountCatalogResult> {
  const apps = await listApps("");
  const results = await mapWithConcurrency(apps, ACCOUNT_CATALOG_CONCURRENCY, async (app) => {
    try {
      const result = await accountsForApp(app.id);
      const entry: AccountCatalogEntry = {
        appId: app.id,
        appName: app.name || app.appName || `App ${app.id}`,
        appUrl: result.appUrl,
        accounts: result.accounts,
      };
      return { entry };
    } catch (error) {
      const failure: AccountCatalogFailure = {
        appId: app.id,
        appName: app.name || app.appName || `App ${app.id}`,
        error: error instanceof Error ? error.message : "账号目录同步失败",
      };
      return { failure };
    }
  });
  const entries = results.flatMap((result) => result.entry ? [result.entry] : []);
  const failures = results.flatMap((result) => result.failure ? [result.failure] : []);
  return { entries, failures, complete: failures.length === 0 };
}

export async function listApps(keyword: string): Promise<UniPassApp[]> {
  const apps: UniPassApp[] = [];
  const pageSize = 100;
  for (let page = 1; page <= APP_LIST_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ current: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set("name", keyword.trim());
    const result = await request<AppPage>(`/app/list?${params}`);
    if (!result || !Array.isArray(result.list)) throw new Error("应用列表返回格式异常");
    const items = result.list;
    if (items.some((item) => !item || typeof item !== "object" || item.id == null)) {
      throw new Error("应用列表包含无效记录");
    }
    apps.push(...items);
    const pages = Number(result.pages ?? result.totalPages ?? 0);
    const total = Number(result.total ?? 0);
    if (!items.length || items.length < pageSize || (pages && page >= pages) || (total && apps.length >= total)) {
      return apps;
    }
  }
  throw new Error(`应用列表超过 ${APP_LIST_MAX_PAGES} 页，账号目录同步未完成`);
}

export async function accountsForApp(appId: string | number): Promise<AccountListResult> {
  const appUrl = await appUrlForApp(appId);
  return accountsForUrl(appUrl);
}

export async function appUrlForApp(appId: string | number): Promise<string> {
  const appUrl = await request<string>(`/app/get_app/url?appId=${encodeURIComponent(String(appId))}`);
  if (!appUrl) throw new Error("该应用没有可用的登录地址");
  const url = new URL(appUrl);
  if (url.protocol !== "https:") throw new Error("为保护凭据安全，仅支持 HTTPS 应用地址");
  return url.toString();
}

export async function credentialAvailableForAccount(accountId: string | number): Promise<boolean> {
  const config = await appConfigForAccount(accountId);
  const encryptedPassword = config?.user?.password;
  if (!encryptedPassword) return false;
  try {
    return await credentialAvailableCiphertext(encryptedPassword);
  } catch {
    throw new Error("密码解密失败，UniPass 算法可能已更新");
  }
}

export async function credentialForAccount(
  accountId: string | number,
): Promise<Credential> {
  const config = await appConfigForAccount(accountId);
  const encryptedPassword = config?.user?.password;
  if (!encryptedPassword) throw new Error("该账号没有可用密码");
  const username = config?.user?.username?.trim() || await usernameFromCatalog(accountId);
  if (!username) throw new Error("该账号缺少可用账号标识");
  return {
    username,
    password: await decryptPassword(encryptedPassword),
  };
}

export async function jupiterCredentialForAccount(
  accountId: string | number,
  fallbackUsername: string,
): Promise<{ username: string; transformedPassword: string }> {
  const config = await appConfigForAccount(accountId);
  const encryptedPassword = config?.user?.password;
  if (!encryptedPassword) throw new Error("该账号没有可用密码");
  try {
    return {
      username: config?.user?.username || fallbackUsername,
      transformedPassword: await transformJupiterCredentialCiphertext(encryptedPassword),
    };
  } catch {
    throw new Error("木星密码处理失败，UniPass 算法可能已更新");
  }
}

async function appConfigForAccount(accountId: string | number): Promise<AppConfig> {
  return (await request<AppConfig>(
    `/app/app_config?accountId=${encodeURIComponent(String(accountId))}`
  )) ?? {};
}

async function request<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Browser-Plugin-Version": await resolvePluginVersion(),
  };
  const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<T>>(`${API_ROOT}${path}`, {
    method: "GET",
    credentials: "include",
    headers,
  });
  if (response.status === 401) throw new Error("UniPass 登录已失效，请重新登录");
  if (!response.ok) throw new Error(body?.message || `UniPass 请求失败（HTTP ${response.status}）`);
  if (!body || body.success === false) throw new Error(body?.message || "UniPass 请求失败");
  return body.result as T;
}

async function resolvePluginVersion(): Promise<string> {
  return (await readPluginVersionOverride()) ?? (await readRuntimeConfig()).networkPluginVersion;
}

async function usernameFromCatalog(accountId: string | number): Promise<string> {
  const catalog = await accountCatalog();
  for (const entry of catalog.entries) {
    const account = entry.accounts.find((candidate) => {
      const id = candidate.id ?? candidate.accountId ?? candidate.appAccountUserId;
      return id != null && String(id) === String(accountId);
    });
    if (account) return account.account?.trim() || account.phoneNumber?.trim() || account.email?.trim() || "";
  }
  return "";
}

async function readPluginVersionOverride(): Promise<string | null> {
  const stored = await chrome.storage.local.get(PLUGIN_VERSION_OVERRIDE_STORAGE_KEY);
  return normalizePluginVersion(stored[PLUGIN_VERSION_OVERRIDE_STORAGE_KEY]);
}

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

async function readRuntimeConfig(): Promise<RuntimeConfig> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = fetch(chrome.runtime.getURL(RUNTIME_CONFIG_FILE), { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取 runtime-config.json");
        const parsed = parseRuntimeConfig(await response.json());
        if (!parsed) throw new Error("runtime-config.json 格式无效");
        return parsed;
      })
      .catch((error) => {
        runtimeConfigPromise = null;
        throw error;
      });
  }
  return runtimeConfigPromise;
}


function validateAccounts(accounts: unknown): UniPassAccount[] {
  if (!Array.isArray(accounts)) throw new Error("账号列表返回格式异常");
  const valid: UniPassAccount[] = [];
  for (const account of accounts) {
    if (!account || typeof account !== "object" || Array.isArray(account)) {
      throw new Error("账号列表包含无效记录");
    }
    const candidate = account as UniPassAccount;
    const ids = [candidate.id, candidate.accountId, candidate.appAccountUserId];
    if (!ids.some(validAccountId)) throw new Error("账号列表包含缺少 ID 的记录");
    if (ids.some((id) => String(id) === "plugin-version-too-low")) {
      throw new Error(candidate.remark || candidate.account || "客户端版本过低");
    }
    valid.push(candidate);
  }
  return valid;
}

function validAccountId(value: unknown): value is string | number {
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "number" && Number.isFinite(value);
}

async function decryptPassword(ciphertext: string): Promise<string> {
  try {
    return await decryptCredentialCiphertext(ciphertext);
  } catch {
    throw new Error("密码解密失败，UniPass 算法可能已更新");
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
