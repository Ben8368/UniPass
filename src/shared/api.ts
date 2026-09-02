import CryptoJS from "crypto-js";
import { normalizeTargetUrl } from "./url";
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
const PASSWORD_KEY = "VlXCSJg7qO66MNrMMJir3g==";

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
  return { override: "", effective: chrome.runtime.getManifest().version, source: "build" };
}

export async function setPluginVersionOverride(version: string): Promise<PluginVersionSettings> {
  if (version.trim()) throw new Error("网络提交版号固定为构建 manifest 版号，不能在弹窗中修改");
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
  return decryptPassword(encryptedPassword).trim().length > 0;
}

export async function credentialForAccount(
  accountId: string | number,
  fallbackUsername: string,
): Promise<Credential> {
  const config = await appConfigForAccount(accountId);
  const encryptedPassword = config?.user?.password;
  if (!encryptedPassword) throw new Error("该账号没有可用密码");
  return {
    username: config?.user?.username || fallbackUsername,
    password: decryptPassword(encryptedPassword),
  };
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
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "GET",
    credentials: "include",
    headers,
  });
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (response.status === 401) throw new Error("UniPass 登录已失效，请重新登录");
  if (!response.ok) throw new Error(body?.message || `UniPass 请求失败（HTTP ${response.status}）`);
  if (!body || body.success === false) throw new Error(body?.message || "UniPass 请求失败");
  return body.result as T;
}

async function resolvePluginVersion(): Promise<string> {
  return chrome.runtime.getManifest().version;
}


function validateAccounts(accounts: UniPassAccount[] | undefined): UniPassAccount[] {
  if (!Array.isArray(accounts)) throw new Error("账号列表返回格式异常");
  const valid: UniPassAccount[] = [];
  for (const account of accounts) {
    if (!account || typeof account !== "object") continue;
    const ids = [account.id, account.accountId, account.appAccountUserId];
    if (ids.some((id) => String(id) === "plugin-version-too-low")) {
      throw new Error(account.remark || account.account || "客户端版本过低");
    }
    valid.push(account);
  }
  return valid;
}

function decryptPassword(ciphertext: string): string {
  const key = CryptoJS.enc.Base64.parse(PASSWORD_KEY);
  const plaintext = CryptoJS.AES.decrypt(ciphertext, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).toString(CryptoJS.enc.Utf8);
  if (!plaintext) throw new Error("密码解密失败，UniPass 算法可能已更新");
  return plaintext;
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
