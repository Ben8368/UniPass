import { accountsForApp, appUrlForApp, jupiterCredentialForAccount } from "../shared/api";
import { fetchJsonWithTimeout } from "../shared/fetch";
import { isStableUserScope } from "../shared/user-scope";
import { isJupiterUrl } from "../shared/url";
import type { JupiterKeepaliveSettings, UniPassAccount } from "../shared/types";
import { assertCurrentUserScope, UserScopeMismatchError } from "./user-scope-guard";

const JUPITER_ORIGIN = "https://jupiter.tec-do.com";
const JUPITER_LOGIN_URL = `${JUPITER_ORIGIN}/phoenix/v1.0/user/login`;
const JUPITER_KEEPALIVE_STORAGE_KEY = "jupiterKeepaliveSettings";
export const JUPITER_KEEPALIVE_ALARM = "jupiter-keepalive";
const JUPITER_KEEPALIVE_SESSION_KEY = "jupiterKeepaliveSession";
const JUPITER_KEEPALIVE_PERIOD_MINUTES = 25;

interface JupiterLoginResponse {
  code?: number | string;
  message?: string;
  msg?: string;
  data?: {
    accessToken?: string;
    [key: string]: unknown;
  };
}

let keepaliveRun: Promise<void> | null = null;
const activeSessionSyncs = new Set<Promise<void>>();

async function readStoredJupiterKeepaliveSettings(): Promise<JupiterKeepaliveSettings> {
  const stored = await chrome.storage.local.get(JUPITER_KEEPALIVE_STORAGE_KEY);
  const value = stored[JUPITER_KEEPALIVE_STORAGE_KEY];
  if (!value || typeof value !== "object") return { enabled: false };
  const settings = value as Partial<JupiterKeepaliveSettings>;
  return {
    enabled: settings.enabled === true,
    userScope: typeof settings.userScope === "string" ? settings.userScope : undefined,
    appId: settings.appId,
    accountId: settings.accountId,
    username: settings.username,
    lastSuccessAt: settings.lastSuccessAt,
    lastError: settings.lastError,
  };
}

export async function getJupiterKeepaliveSettings(userScope: string): Promise<JupiterKeepaliveSettings> {
  const settings = await readStoredJupiterKeepaliveSettings();
  if (!settings.enabled) return settings;
  if (settings.userScope !== userScope.trim()) {
    await disableJupiterKeepalive();
    return { enabled: false };
  }
  return settings;
}

export async function setJupiterKeepalive(
  userScope: string,
  enabled: boolean,
  appId?: string | number,
  _accountId?: string | number,
  _username?: string,
): Promise<JupiterKeepaliveSettings> {
  if (!enabled) {
    await disableJupiterKeepalive();
    return { enabled: false };
  }
  if (appId == null) throw new Error("未选择木星应用");

  const appUrl = await appUrlForApp(appId);
  if (new URL(appUrl).origin !== JUPITER_ORIGIN) throw new Error("仅支持为木星应用开启保活");
  const result = await accountsForApp(appId);
  const account = preferredJupiterAccount(result.accounts);
  if (!account) throw new Error("木星应用没有可用账号");
  const selectedAccountId = account.id ?? account.accountId ?? account.appAccountUserId;
  const selectedUsername = account.account || account.phoneNumber || account.email || "";
  if (selectedAccountId == null || !selectedUsername) throw new Error("木星应用没有可用的登录凭据");
  if (!selectedUsername.includes("@")) throw new Error("木星应用凭据不是登录邮箱");

  const settings: JupiterKeepaliveSettings = {
    enabled: true,
    userScope: userScope.trim(),
    appId,
    accountId: selectedAccountId,
    username: selectedUsername,
  };
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
  await chrome.alarms.create(JUPITER_KEEPALIVE_ALARM, {
    periodInMinutes: JUPITER_KEEPALIVE_PERIOD_MINUTES,
  });
  await runKeepJupiterAlive();
  return getJupiterKeepaliveSettings(userScope);
}

function preferredJupiterAccount(accounts: UniPassAccount[]): UniPassAccount | undefined {
  return accounts.find((account) => account.topPriority) ?? accounts[0];
}

export async function restoreJupiterKeepaliveAlarm(): Promise<void> {
  const settings = await readStoredJupiterKeepaliveSettings();
  if (!settings.enabled) return;
  if (!settings.userScope || !isStableUserScope(settings.userScope)) {
    await disableJupiterKeepalive();
    return;
  }
  try {
    await assertCurrentUserScope(settings.userScope);
    await chrome.alarms.create(JUPITER_KEEPALIVE_ALARM, {
      periodInMinutes: JUPITER_KEEPALIVE_PERIOD_MINUTES,
    });
    await runKeepJupiterAlive();
  } catch (error) {
    if (error instanceof UserScopeMismatchError) await disableJupiterKeepalive();
    else {
      const message = error instanceof Error ? error.message : "木星保活恢复失败";
      await saveJupiterKeepaliveResult({ ...settings, lastError: message });
    }
  }
}

export function runKeepJupiterAlive(): Promise<void> {
  if (!keepaliveRun) {
    keepaliveRun = keepJupiterAlive().finally(() => { keepaliveRun = null; });
  }
  return keepaliveRun;
}

async function keepJupiterAlive(): Promise<void> {
  const settings = await readStoredJupiterKeepaliveSettings();
  if (!settings.enabled || !settings.userScope || settings.accountId == null || !settings.username) return;
  try {
    await assertCurrentUserScope(settings.userScope);
  } catch (error) {
    if (error instanceof UserScopeMismatchError) await disableJupiterKeepalive();
    return;
  }

  let credential: { username: string; transformedPassword: string } | undefined;
  try {
    credential = await jupiterCredentialForAccount(settings.accountId, settings.username);
    // Keepalive is a background login renewal: never log out, navigate, or reload Jupiter.
    const loginData = await loginToJupiter(credential.username, credential.transformedPassword);
    await assertCurrentUserScope(settings.userScope);
    const latestSettings = await readStoredJupiterKeepaliveSettings();
    if (!latestSettings.enabled || latestSettings.userScope !== settings.userScope) return;
    await syncJupiterSession(loginData, settings.userScope);
    await saveJupiterKeepaliveResult({
      ...latestSettings,
      lastSuccessAt: Date.now(),
      lastError: undefined,
    });
  } catch (error) {
    if (error instanceof UserScopeMismatchError) {
      await disableJupiterKeepalive();
      return;
    }
    const message = error instanceof Error ? error.message : "木星保活失败";
    const latestSettings = await readStoredJupiterKeepaliveSettings();
    if (latestSettings.enabled && latestSettings.userScope === settings.userScope) {
      await saveJupiterKeepaliveResult({ ...latestSettings, lastError: message });
    }
  } finally {
    if (credential) {
      credential.username = "";
      credential.transformedPassword = "";
      credential = undefined;
    }
  }
}

/** Submit a fresh Jupiter login request without touching the open page. */
async function loginToJupiter(email: string, transformedPassword: string): Promise<JupiterLoginResponse["data"]> {
  const { response, body } = await fetchJsonWithTimeout<JupiterLoginResponse>(JUPITER_LOGIN_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      requestId: crypto.randomUUID(),
    },
    body: JSON.stringify({
      email,
      password: transformedPassword,
      isRemember: 1,
      isAgree: 1,
    }),
  });
  transformedPassword = "";
  if (!response.ok) {
    throw new Error(body?.message || body?.msg || `木星登录失败（HTTP ${response.status}）`);
  }
  if (!body?.data?.accessToken) throw new Error(body?.message || body?.msg || "木星登录未返回会话令牌");
  return body.data;
}

async function syncJupiterSession(
  loginData: JupiterLoginResponse["data"],
  userScope: string,
): Promise<void> {
  const accessToken = loginData?.accessToken;
  if (!accessToken) return;
  // Session storage is cleared with the browser session; no Jupiter token is persisted to disk by the extension.
  await chrome.storage.session.set({
    [JUPITER_KEEPALIVE_SESSION_KEY]: { ...loginData, userScope },
  });
  const tabs = await chrome.tabs.query({ url: [`${JUPITER_ORIGIN}/*`] });
  await Promise.all(
    tabs
      .filter((tab) => tab.id != null && tab.url != null && isJupiterUrl(tab.url))
      .map((tab) => syncStoredJupiterSessionToTab(tab.id as number)),
  );
}

export async function syncStoredJupiterSessionToTab(tabId: number): Promise<void> {
  const sync = syncStoredJupiterSessionToTabInner(tabId);
  activeSessionSyncs.add(sync);
  void sync.then(
    () => activeSessionSyncs.delete(sync),
    () => activeSessionSyncs.delete(sync),
  );
  return sync;
}

async function syncStoredJupiterSessionToTabInner(tabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(JUPITER_KEEPALIVE_SESSION_KEY);
  const loginData = stored[JUPITER_KEEPALIVE_SESSION_KEY] as
    | (JupiterLoginResponse["data"] & { userScope?: string })
    | undefined;
  const accessToken = loginData?.accessToken;
  if (!accessToken || !loginData?.userScope || !isStableUserScope(loginData.userScope)) {
    await chrome.storage.session.remove(JUPITER_KEEPALIVE_SESSION_KEY);
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isJupiterUrl(tab.url)) return;
    await assertCurrentUserScope(loginData.userScope);
    const settings = await readStoredJupiterKeepaliveSettings();
    if (!settings.enabled || settings.userScope !== loginData.userScope) return;
    const { userScope: _userScope, ...sessionData } = loginData;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (token: string, userInfo: object) => {
        if (location.origin !== "https://jupiter.tec-do.com") return;
        if (localStorage.getItem("ACCESS_TOKEN") === token) return;
        localStorage.setItem("ACCESS_TOKEN", token);
        localStorage.setItem("PH_USER_INFO", JSON.stringify(userInfo));
        // Keep the current SPA running; the next request can read the renewed token without a reload.
        // Do not dispatch a storage event because some auth guards treat it as a logout signal.
      },
      args: [accessToken, sessionData],
    });
  } catch (error: unknown) {
    if (error instanceof UserScopeMismatchError) {
      await disableJupiterKeepalive(false);
      return;
    }
    // A tab can close or be replaced after tabs.query/onUpdated reports it.
    if (isMissingTabError(error)) return;
    throw error;
  }
}

function isMissingTabError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no tab with id/i.test(message);
}

async function disableJupiterKeepalive(waitForActiveSyncs = true): Promise<void> {
  await chrome.alarms.clear(JUPITER_KEEPALIVE_ALARM);
  await chrome.storage.local.set({
    [JUPITER_KEEPALIVE_STORAGE_KEY]: { enabled: false },
  });
  await chrome.storage.session.remove(JUPITER_KEEPALIVE_SESSION_KEY);
  if (waitForActiveSyncs) await waitForActiveSessionSyncs();
  // A sync that started before disable may have read the token already. Remove again after
  // it settles so no extension-owned session token remains available for later tab updates.
  await chrome.storage.session.remove(JUPITER_KEEPALIVE_SESSION_KEY);
}

async function waitForActiveSessionSyncs(): Promise<void> {
  await Promise.all([...activeSessionSyncs].map((sync) => sync.catch(() => undefined)));
}

async function saveJupiterKeepaliveResult(settings: JupiterKeepaliveSettings): Promise<void> {
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
}
