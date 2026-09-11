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
import { popupSessionUserFor } from "../shared/user-scope";
import { isJupiterUrl } from "../shared/url";
import { clearCredentialAvailabilityCache, credentialAvailability } from "./credential-availability";
import {
  getJupiterKeepaliveSettings,
  JUPITER_KEEPALIVE_ALARM,
  restoreJupiterKeepaliveAlarm,
  runKeepJupiterAlive,
  setJupiterKeepalive,
  syncStoredJupiterSessionToTab,
} from "./jupiter-keepalive";
import { clearUniPassLoginForTab, completeUniPassLogin, processUniPassLoginTab, startUniPassLogin } from "./unipass-login";
import { fillFromOverlay, fillFromPopup, openApp, pageContextFor, pageThemeFor, togglePageOverlay } from "./page-overlay";
import { readSelfBuildFile } from "./self-build-files";
import { withUserScope } from "./user-scope-guard";
import type { BackgroundRequest, BackgroundResponse } from "../shared/types";

void restoreJupiterKeepaliveAlarm().catch((error: unknown) => {
  console.warn("木星保活恢复失败", error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === JUPITER_KEEPALIVE_ALARM) void runKeepJupiterAlive();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if ((changeInfo.status === "loading" || changeInfo.status === "complete") && tab.url) {
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
    case "fillFromPopup":
      return withUserScope(message.userScope, () => fillFromPopup(message));
    case "startUniPassLogin":
      return startUniPassLogin();
    case "completeUniPassLogin":
      return completeUniPassLogin();
    case "getPluginVersionSettings":
      return pluginVersionSettings();
    case "setPluginVersionOverride":
      return setPluginVersionOverride(message.version);
    case "readSelfBuildFile":
      return readSelfBuildFile(message.path);
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

async function refreshAccountCatalog(): Promise<Awaited<ReturnType<typeof accountCatalog>>> {
  const result = await accountCatalog();
  await clearCredentialAvailabilityCache();
  return result;
}
