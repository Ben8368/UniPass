import CryptoJS from "crypto-js";
import {
  accountCatalog,
  accountsForApp,
  appUrlForApp,
  credentialForAccount,
  currentUser,
  listApps,
  pluginVersionSettings,
  setPluginVersionOverride,
} from "../shared/api";
import { isStableUserScope, popupSessionUserFor, requireStableUserScope, userScopeFor } from "../shared/user-scope";
import { fetchJsonWithTimeout } from "../shared/fetch";
import { isJupiterUrl } from "../shared/url";
import { clearCredentialAvailabilityCache, credentialAvailability } from "./credential-availability";
import { clearUniPassLoginForTab, processUniPassLoginTab, startUniPassLogin } from "./unipass-login";
import { fillFromOverlay, openApp, pageContextFor, pageThemeFor, togglePageOverlay } from "./page-overlay";
import type {
  BackgroundRequest,
  BackgroundResponse,
  JupiterKeepaliveSettings,
  UniPassAccount,
} from "../shared/types";

const JUPITER_ORIGIN = "https://jupiter.tec-do.com";
const JUPITER_LOGIN_URL = `${JUPITER_ORIGIN}/phoenix/v1.0/user/login`;
const JUPITER_KEEPALIVE_STORAGE_KEY = "jupiterKeepaliveSettings";
const JUPITER_KEEPALIVE_ALARM = "jupiter-keepalive";
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

class UserScopeMismatchError extends Error {}

let keepaliveRun: Promise<void> | null = null;

void restoreJupiterKeepaliveAlarm().catch((error: unknown) => {
  console.warn("木星保活恢复失败", error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === JUPITER_KEEPALIVE_ALARM) void runKeepJupiterAlive();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    void processUniPassLoginTab(tabId, tab.url).catch((error: unknown) => {
      console.warn("UniPass 登录辅助失败", error);
    });
  }
  if (changeInfo.status === "complete" && tab.url && isJupiterUrl(tab.url)) {
    void syncStoredJupiterSessionToTab(tabId).catch((error: unknown) => {
      console.warn("木星会话同步失败", error);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearUniPassLoginForTab(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  void togglePageOverlay(tab.id).catch((error: unknown) => {
    console.warn("UniPass 页面浮层打开失败", error);
  });
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, sender, sendResponse: (response: BackgroundResponse) => void) => {
    handle(message, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "未知错误";
        sendResponse({ ok: false, error: text });
      });
    return true;
  },
);

function handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender = {}): Promise<unknown> {
  switch (message.type) {
    case "session":
      return currentUser().then(popupSessionUserFor);
    case "pageContext":
      return pageContextFor(sender);
    case "pageTheme":
      return pageThemeFor(sender);
    case "openApp":
      return withUserScope(message.userScope, () => openApp(message.appId));
    case "fillFromOverlay":
      return withUserScope(message.userScope, () => fillFromOverlay(sender, message));
    case "startUniPassLogin":
      return startUniPassLogin();
    case "getPluginVersionSettings":
      return pluginVersionSettings();
    case "setPluginVersionOverride":
      return setPluginVersionOverride(message.version);
    case "accountCatalog":
      return withUserScope(message.userScope, refreshAccountCatalog);
    case "listApps":
      return withUserScope(message.userScope, () => listApps(message.keyword));
    case "accountsForApp":
      return withUserScope(message.userScope, () => accountsForApp(message.appId));
    case "appUrl":
      return withUserScope(message.userScope, () => appUrlForApp(message.appId));
    case "credentialAvailability":
      return withUserScope(message.userScope, () => credentialAvailability(message.accountIds, message.userScope));
    case "credential":
      return withUserScope(message.userScope, () => credentialForAccount(message.accountId, message.fallbackUsername));
    case "getJupiterKeepalive":
      return withUserScope(message.userScope, () => getJupiterKeepaliveSettings(message.userScope));
    case "setJupiterKeepalive":
      return withUserScope(message.userScope, () => setJupiterKeepalive(message.userScope, message.enabled, message.appId, message.accountId, message.username));
    default:
      return Promise.reject(new Error("不支持的扩展请求"));
  }
}


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

async function getJupiterKeepaliveSettings(userScope: string): Promise<JupiterKeepaliveSettings> {
  const settings = await readStoredJupiterKeepaliveSettings();
  if (!settings.enabled) return settings;
  if (settings.userScope !== userScope.trim()) {
    await disableJupiterKeepalive();
    return { enabled: false };
  }
  return settings;
}

async function setJupiterKeepalive(
  userScope: string,
  enabled: boolean,
  appId?: string | number,
  accountId?: string | number,
  username?: string,
): Promise<JupiterKeepaliveSettings> {
  if (!enabled) {
    await chrome.alarms.clear(JUPITER_KEEPALIVE_ALARM);
    const settings: JupiterKeepaliveSettings = { enabled: false };
    await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
    await chrome.storage.session.remove(JUPITER_KEEPALIVE_SESSION_KEY);
    return settings;
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

  const settings: JupiterKeepaliveSettings = { enabled: true, userScope: userScope.trim(), appId, accountId: selectedAccountId, username: selectedUsername };
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
  await chrome.alarms.create(JUPITER_KEEPALIVE_ALARM, { periodInMinutes: JUPITER_KEEPALIVE_PERIOD_MINUTES });
  await runKeepJupiterAlive();
  return getJupiterKeepaliveSettings(userScope);
}

function preferredJupiterAccount(accounts: UniPassAccount[]): UniPassAccount | undefined {
  return accounts.find((account) => account.topPriority) ?? accounts[0];
}

async function restoreJupiterKeepaliveAlarm(): Promise<void> {
  const settings = await readStoredJupiterKeepaliveSettings();
  if (!settings.enabled) return;
  if (!settings.userScope || !isStableUserScope(settings.userScope)) {
    await disableJupiterKeepalive();
    return;
  }
  try {
    await assertCurrentUserScope(settings.userScope);
    await chrome.alarms.create(JUPITER_KEEPALIVE_ALARM, { periodInMinutes: JUPITER_KEEPALIVE_PERIOD_MINUTES });
    await runKeepJupiterAlive();
  } catch (error) {
    if (error instanceof UserScopeMismatchError) await disableJupiterKeepalive();
    else {
      const message = error instanceof Error ? error.message : "木星保活恢复失败";
      await saveJupiterKeepaliveResult({ ...settings, lastError: message });
    }
  }
}

function runKeepJupiterAlive(): Promise<void> {
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

  let password = "";
  let credential: { username: string; password: string } | undefined;
  try {
    credential = await credentialForAccount(settings.accountId, settings.username);
    password = credential.password;
    const loginData = await loginToJupiter(credential.username, password);
    await assertCurrentUserScope(settings.userScope);
    await syncJupiterSession(loginData, settings.userScope);
    await saveJupiterKeepaliveResult({ ...settings, lastSuccessAt: Date.now(), lastError: undefined });
  } catch (error) {
    if (error instanceof UserScopeMismatchError) {
      await disableJupiterKeepalive();
      return;
    }
    const message = error instanceof Error ? error.message : "木星保活失败";
    await saveJupiterKeepaliveResult({ ...settings, lastError: message });
  } finally {
    password = "";
    if (credential) credential.password = "";
  }
}

async function loginToJupiter(email: string, password: string): Promise<JupiterLoginResponse["data"]> {
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
      password: encryptJupiterPassword(password),
      isRemember: 1,
      isAgree: 1,
    }),
  });
  if (!response.ok) throw new Error(body?.message || body?.msg || `木星登录失败（HTTP ${response.status}）`);
  if (!body?.data?.accessToken) throw new Error(body?.message || body?.msg || "木星登录未返回会话令牌");
  return body.data;
}

function encryptJupiterPassword(password: string): string {
  const md5Value = CryptoJS.MD5(password).toString();
  return CryptoJS.DES.encrypt(
    CryptoJS.enc.Utf8.parse(md5Value),
    CryptoJS.enc.Utf8.parse("phoenix_toptou"),
    { iv: CryptoJS.enc.Utf8.parse(""), mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  ).ciphertext.toString().toUpperCase();
}

async function syncJupiterSession(loginData: JupiterLoginResponse["data"], userScope: string): Promise<void> {
  const accessToken = loginData?.accessToken;
  if (!accessToken) return;
  // Session storage is cleared with the browser session; no Jupiter token is persisted to disk by the extension.
  await chrome.storage.session.set({ [JUPITER_KEEPALIVE_SESSION_KEY]: { ...loginData, userScope } });
  const tabs = await chrome.tabs.query({ url: [`${JUPITER_ORIGIN}/*`] });
  await Promise.all(tabs.filter((tab) => tab.id != null && tab.url != null && isJupiterUrl(tab.url))
    .map((tab) => syncStoredJupiterSessionToTab(tab.id as number)));
}

async function syncStoredJupiterSessionToTab(tabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(JUPITER_KEEPALIVE_SESSION_KEY);
  const loginData = stored[JUPITER_KEEPALIVE_SESSION_KEY] as (JupiterLoginResponse["data"] & { userScope?: string }) | undefined;
  const accessToken = loginData?.accessToken;
  if (!accessToken || !loginData?.userScope || !isStableUserScope(loginData.userScope)) {
    await chrome.storage.session.remove(JUPITER_KEEPALIVE_SESSION_KEY);
    return;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isJupiterUrl(tab.url)) return;
    await assertCurrentUserScope(loginData.userScope);
    const { userScope: _userScope, ...sessionData } = loginData;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (token: string, userInfo: object) => {
        if (location.origin !== "https://jupiter.tec-do.com") return;
        if (localStorage.getItem("ACCESS_TOKEN") === token) return;
        localStorage.setItem("ACCESS_TOKEN", token);
        localStorage.setItem("PH_USER_INFO", JSON.stringify(userInfo));
        location.reload();
      },
      args: [accessToken, sessionData],
    });
  } catch (error: unknown) {
    if (error instanceof UserScopeMismatchError) {
      await disableJupiterKeepalive();
      return;
    }
    // A tab can close or be replaced after tabs.query/onUpdated reports it.
    if (isMissingTabError(error)) return;
    throw error;
  }
}

async function refreshAccountCatalog(): Promise<Awaited<ReturnType<typeof accountCatalog>>> {
  const result = await accountCatalog();
  await clearCredentialAvailabilityCache();
  return result;
}

function isMissingTabError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no tab with id/i.test(message);
}

async function withUserScope<T>(userScope: string | undefined, operation: () => Promise<T>): Promise<T> {
  const scope = requireStableUserScope(userScope);
  await assertCurrentUserScope(scope);
  const result = await operation();
  await assertCurrentUserScope(scope);
  return result;
}

async function assertCurrentUserScope(expectedScope: string): Promise<void> {
  const actualScope = userScopeFor(await currentUser());
  if (!actualScope) throw new UserScopeMismatchError("UniPass 会话缺少稳定用户标识");
  if (actualScope !== expectedScope.trim()) throw new UserScopeMismatchError("UniPass 用户已切换，请重新打开弹窗");
}

async function disableJupiterKeepalive(): Promise<void> {
  await chrome.alarms.clear(JUPITER_KEEPALIVE_ALARM);
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: { enabled: false } });
  await chrome.storage.session.remove(JUPITER_KEEPALIVE_SESSION_KEY);
}

async function saveJupiterKeepaliveResult(settings: JupiterKeepaliveSettings): Promise<void> {
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
}
