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
import type { BackgroundRequest, BackgroundResponse, JupiterKeepaliveSettings, UniPassAccount } from "../shared/types";

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

void restoreJupiterKeepaliveAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === JUPITER_KEEPALIVE_ALARM) void keepJupiterAlive();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url?.startsWith(JUPITER_ORIGIN)) {
    void syncStoredJupiterSessionToTab(tabId).catch((error: unknown) => {
      console.warn("木星会话同步失败", error);
    });
  }
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "未知错误";
        sendResponse({ ok: false, error: text });
      });
    return true;
  },
);

function handle(message: BackgroundRequest): Promise<unknown> {
  switch (message.type) {
    case "session":
      return currentUser();
    case "getPluginVersionSettings":
      return pluginVersionSettings();
    case "setPluginVersionOverride":
      return setPluginVersionOverride(message.version);
    case "accountCatalog":
      return accountCatalog();
    case "listApps":
      return listApps(message.keyword);
    case "accountsForApp":
      return accountsForApp(message.appId);
    case "appUrl":
      return appUrlForApp(message.appId);
    case "credential":
      return credentialForAccount(message.accountId, message.fallbackUsername);
    case "getJupiterKeepalive":
      return getJupiterKeepaliveSettings();
    case "setJupiterKeepalive":
      return setJupiterKeepalive(message.enabled, message.appId, message.accountId, message.username);
    default:
      return Promise.reject(new Error("不支持的扩展请求"));
  }
}


async function getJupiterKeepaliveSettings(): Promise<JupiterKeepaliveSettings> {
  const stored = await chrome.storage.local.get(JUPITER_KEEPALIVE_STORAGE_KEY);
  const value = stored[JUPITER_KEEPALIVE_STORAGE_KEY];
  if (!value || typeof value !== "object") return { enabled: false };
  const settings = value as Partial<JupiterKeepaliveSettings>;
  return {
    enabled: settings.enabled === true,
    appId: settings.appId,
    accountId: settings.accountId,
    username: settings.username,
    lastSuccessAt: settings.lastSuccessAt,
    lastError: settings.lastError,
  };
}

async function setJupiterKeepalive(
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

  const settings: JupiterKeepaliveSettings = { enabled: true, appId, accountId: selectedAccountId, username: selectedUsername };
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
  await chrome.alarms.create(JUPITER_KEEPALIVE_ALARM, { periodInMinutes: JUPITER_KEEPALIVE_PERIOD_MINUTES });
  await keepJupiterAlive();
  return getJupiterKeepaliveSettings();
}

function preferredJupiterAccount(accounts: UniPassAccount[]): UniPassAccount | undefined {
  return accounts.find((account) => account.topPriority) ?? accounts[0];
}

async function restoreJupiterKeepaliveAlarm(): Promise<void> {
  const settings = await getJupiterKeepaliveSettings();
  if (settings.enabled) {
    await chrome.alarms.create(JUPITER_KEEPALIVE_ALARM, { periodInMinutes: JUPITER_KEEPALIVE_PERIOD_MINUTES });
  }
}

async function keepJupiterAlive(): Promise<void> {
  const settings = await getJupiterKeepaliveSettings();
  if (!settings.enabled || settings.accountId == null || !settings.username) return;

  let password = "";
  let credential: { username: string; password: string } | undefined;
  try {
    credential = await credentialForAccount(settings.accountId, settings.username);
    password = credential.password;
    const loginData = await loginToJupiter(credential.username, password);
    await syncJupiterSession(loginData);
    await saveJupiterKeepaliveResult({ ...settings, lastSuccessAt: Date.now(), lastError: undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "木星保活失败";
    await saveJupiterKeepaliveResult({ ...settings, lastError: message });
  } finally {
    password = "";
    if (credential) credential.password = "";
  }
}

async function loginToJupiter(email: string, password: string): Promise<JupiterLoginResponse["data"]> {
  const response = await fetch(JUPITER_LOGIN_URL, {
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
  const body = (await response.json().catch(() => null)) as JupiterLoginResponse | null;
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

async function syncJupiterSession(loginData: JupiterLoginResponse["data"]): Promise<void> {
  const accessToken = loginData?.accessToken;
  if (!accessToken) return;
  // Session storage is cleared with the browser session; no Jupiter token is persisted to disk by the extension.
  await chrome.storage.session.set({ [JUPITER_KEEPALIVE_SESSION_KEY]: loginData });
  const tabs = await chrome.tabs.query({ url: [`${JUPITER_ORIGIN}/*`] });
  await Promise.all(tabs.filter((tab) => tab.id != null && tab.url?.startsWith(JUPITER_ORIGIN))
    .map((tab) => syncStoredJupiterSessionToTab(tab.id as number)));
}

async function syncStoredJupiterSessionToTab(tabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(JUPITER_KEEPALIVE_SESSION_KEY);
  const loginData = stored[JUPITER_KEEPALIVE_SESSION_KEY] as JupiterLoginResponse["data"] | undefined;
  const accessToken = loginData?.accessToken;
  if (!accessToken) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (token: string, userInfo: object) => {
        if (localStorage.getItem("ACCESS_TOKEN") === token) return;
        localStorage.setItem("ACCESS_TOKEN", token);
        localStorage.setItem("PH_USER_INFO", JSON.stringify(userInfo));
        location.reload();
      },
      args: [accessToken, loginData],
    });
  } catch (error: unknown) {
    // A tab can close or be replaced after tabs.query/onUpdated reports it.
    if (isMissingTabError(error)) return;
    throw error;
  }
}

function isMissingTabError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no tab with id/i.test(message);
}

async function saveJupiterKeepaliveResult(settings: JupiterKeepaliveSettings): Promise<void> {
  await chrome.storage.local.set({ [JUPITER_KEEPALIVE_STORAGE_KEY]: settings });
}
