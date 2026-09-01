import CryptoJS from "crypto-js";
import type {
  AccountListResult,
  Credential,
  CurrentUser,
  UniPassAccount,
  UniPassApp,
} from "./types";

const PORTAL_ORIGIN = "https://portal.unipass.top";
const API_ROOT = `${PORTAL_ORIGIN}/api/v1`;
const API_COMPAT_VERSION = "5.3.0";
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
  const login = await request<boolean>("/login/isLogin", true);
  if (login !== true) throw new Error("尚未登录 UniPass");
  return (await request<CurrentUser>("/session/current_user")) ?? {};
}

export async function accountsForUrl(url: string): Promise<AccountListResult> {
  const normalized = normalizeTargetUrl(url);
  const result = await request<AccountEnvelope>(
    `/app/account/account/list/url?url=${encodeURIComponent(normalized)}`,
    true,
  );
  return { appUrl: normalized, accounts: validateAccounts(result?.accounts) };
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
    `/app/app_config?accountId=${encodeURIComponent(String(accountId))}`,
    true,
  );
  const encryptedPassword = config?.user?.password;
  if (!encryptedPassword) throw new Error("该账号没有可用密码");
  return {
    username: config?.user?.username || fallbackUsername,
    password: decryptPassword(encryptedPassword),
  };
}

async function request<T>(path: string, includePluginVersion = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (includePluginVersion) headers["X-Browser-Plugin-Version"] = API_COMPAT_VERSION;
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
