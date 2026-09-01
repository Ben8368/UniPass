import CryptoJS from "crypto-js";
import type {
  AccountCatalogEntry,
  AccountListResult,
  Credential,
  CurrentUser,
  UniPassAccount,
  UniPassApp,
  PluginVersionSettings,
} from "./types";

const PORTAL_ORIGIN = "https://portal.unipass.top";
const API_ROOT = `${PORTAL_ORIGIN}/api/v1`;
const API_COMPAT_VERSION = "5.3.0";
const WEBSTORE_VERSION_URL = "https://chromewebstore.google.com/detail/unipass/gjphikebcceegfolnbfncepfmjnhdkam";
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

let resolvedVersionPromise: Promise<string> | undefined;
let resolvedVersionSource: "store" | "fallback" = "fallback";

export async function currentUser(): Promise<CurrentUser> {
  const login = await request<boolean>("/login/isLogin");
  if (login !== true) throw new Error("尚未登录 UniPass");
  return (await request<CurrentUser>("/session/current_user")) ?? {};
}

export async function pluginVersionSettings(): Promise<PluginVersionSettings> {
  const override = await readVersionOverride();
  if (override) return { override, effective: override, source: "manual" };
  const storeVersion = await resolvePluginVersion();
  return { override: "", effective: storeVersion, source: resolvedVersionSource };
}

export async function setPluginVersionOverride(version: string): Promise<PluginVersionSettings> {
  const normalized = version.trim();
  if (normalized && !isPluginVersion(normalized)) throw new Error("版本号格式应为 x.y.z，例如 5.3.0");
  await chrome.storage.local.set({ pluginVersionOverride: normalized });
  resolvedVersionPromise = undefined;
  return pluginVersionSettings();
}

export async function accountsForUrl(url: string): Promise<AccountListResult> {
  const normalized = normalizeTargetUrl(url);
  const result = await request<AccountEnvelope>(
    `/app/account/account/list/url?url=${encodeURIComponent(normalized)}`
  );
  return { appUrl: normalized, accounts: validateAccounts(result?.accounts) };
}

export async function accountCatalog(): Promise<AccountCatalogEntry[]> {
  const apps = await listApps("");
  const entries: AccountCatalogEntry[] = [];
  for (const app of apps) {
    try {
      const result = await accountsForApp(app.id);
      entries.push({
        appId: app.id,
        appName: app.name || app.appName || `App ${app.id}`,
        appUrl: result.appUrl,
        accounts: result.accounts,
      });
    } catch {
      // One unavailable app must not stop the rest of the catalog syncing.
    }
  }
  return entries;
}

export async function listApps(keyword: string): Promise<UniPassApp[]> {
  const apps: UniPassApp[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 20; page += 1) {
    const params = new URLSearchParams({ current: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set("name", keyword.trim());
    const result = (await request<AppPage>(`/app/list?${params}`)) ?? {};
    const items = Array.isArray(result.list) ? result.list : [];
    apps.push(...items.filter((item): item is UniPassApp => Boolean(item && item.id != null)));
    const pages = Number(result.pages ?? result.totalPages ?? 0);
    const total = Number(result.total ?? 0);
    if (!items.length || items.length < pageSize || (pages && page >= pages) || (total && apps.length >= total)) break;
  }
  return apps;
}

export async function accountsForApp(appId: string | number): Promise<AccountListResult> {
  const appUrl = await appUrlForApp(appId);
  return accountsForUrl(appUrl);
}

export async function appUrlForApp(appId: string | number): Promise<string> {
  const appUrl = await request<string>(`/app/get_app/url?appId=${encodeURIComponent(String(appId))}`);
  if (!appUrl) throw new Error("该应用没有可用的登录地址");
  const url = new URL(appUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("该应用的登录地址不支持跳转");
  return url.toString();
}

export async function credentialForAccount(
  accountId: string | number,
  fallbackUsername: string,
): Promise<Credential> {
  const config = await request<AppConfig>(
    `/app/app_config?accountId=${encodeURIComponent(String(accountId))}`
  );
  const encryptedPassword = config?.user?.password;
  if (!encryptedPassword) throw new Error("该账号没有可用密码");
  return {
    username: config?.user?.username || fallbackUsername,
    password: decryptPassword(encryptedPassword),
  };
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
  const override = await readVersionOverride();
  if (override) return override;
  if (!resolvedVersionPromise) {
    resolvedVersionPromise = fetchStoreVersion()
      .then((version) => { resolvedVersionSource = "store"; return version; })
      .catch(() => { resolvedVersionSource = "fallback"; return API_COMPAT_VERSION; })
      .finally(() => { resolvedVersionPromise = undefined; });
  }
  return resolvedVersionPromise;
}

async function readVersionOverride(): Promise<string> {
  const stored = await chrome.storage.local.get("pluginVersionOverride");
  const override = stored.pluginVersionOverride;
  return typeof override === "string" && isPluginVersion(override.trim()) ? override.trim() : "";
}

async function fetchStoreVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(WEBSTORE_VERSION_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Web Store request failed: ${response.status}`);
    const html = await response.text();
    const version = extractVersionFromStorePage(html);
    if (!version || !isPluginVersion(version)) throw new Error("Web Store version not found");
    return version;
  } finally {
    clearTimeout(timeout);
  }
}

function extractVersionFromStorePage(html: string): string | undefined {
  const patterns = [
    /"version"\s*:\s*"(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)"/i,
    /version\\?"\s*:\s*\\?"(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\\?"/i,
    />?\s*Version\s*<[^>]*>\s*(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i,
  ];
  for (const pattern of patterns) {
    const version = html.match(pattern)?.[1];
    if (version && isPluginVersion(version)) return version;
  }
  return undefined;
}

function isPluginVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function normalizeTargetUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (!url.hostname.includes("huaban") && !url.hostname.includes("gaoding")) url.search = "";
  return url.toString();
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
