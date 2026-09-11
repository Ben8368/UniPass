import {
  accountCatalog,
  accountsForApp,
  appUrlForApp,
  credentialForAccount,
  currentUser,
  pluginVersionSettings,
  setPluginVersionOverride,
} from "../shared/api";
import {
  credentialAvailableForRef,
  credentialForRef,
  createVaultAccount,
  createVaultApp,
  deleteVaultAccount,
  deleteVaultApp,
  listVaultProfiles,
  removeVault,
  saveWebDavVault,
  testWebDavConnection,
  updateVaultAccount,
  updateVaultApp,
  updateVaultCredential,
  vaultAccounts,
  vaultAppUrl,
  vaultApps,
  vaultCatalog,
} from "./vault/vault-service";
import { popupSessionUserFor } from "../shared/user-scope";
import { isJupiterUrl } from "../shared/url";
import { appsWithAvailableCredentials, clearCredentialAvailabilityCache, credentialAvailability } from "./credential-availability";
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
import { AdvancedCapabilityRegistry } from "./advanced-capability";
import type { BackgroundRequest, BackgroundResponse } from "../shared/types";

const advancedCapabilities = new AdvancedCapabilityRegistry();

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

chrome.runtime.onConnect.addListener((port) => {
  try {
    advancedCapabilities.attachPort(port);
  } catch {
    if (port.name === "unipass-advanced-mode") port.disconnect();
  }
});

function handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender = {}): Promise<unknown> {
  switch (message.type) {
    case "session":
      return currentUser().then(popupSessionUserFor);
    case "pageContext":
      return pageContextFor(sender);
    case "pageTheme":
      return pageThemeFor(sender);
    case "openApp":
      return withUserScope(message.userScope, async () => {
        if (message.vaultId) return chrome.tabs.create({ url: await vaultAppUrl(message.vaultId, String(message.appId)) });
        return openApp(message.appId);
      });
    case "enableAdvancedMode":
      return Promise.resolve(advancedCapabilities.prepare(sender));
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
      return withUserScope(message.userScope, async () => {
        const legacy = await appsWithAvailableCredentials(message.keyword, message.userScope);
        const extra = (await vaultApps()).filter((app) => !message.keyword.trim() || app.name.toLowerCase().includes(message.keyword.trim().toLowerCase())).map((app) => ({
          id: app.id,
          name: app.name,
          vaultId: app.vaultId,
          appRef: { vaultId: app.vaultId, appId: app.id },
          targets: app.targets,
        }));
        return { ...legacy, apps: [...legacy.apps, ...extra], totalApps: legacy.totalApps + extra.length };
      });
    case "accountsForApp":
      return withUserScope(message.userScope, () => message.vaultId ? vaultAccounts(message.vaultId, String(message.appId)) : accountsForApp(message.appId));
    case "appUrl":
      return withUserScope(message.userScope, () => message.vaultId ? vaultAppUrl(message.vaultId, String(message.appId)) : appUrlForApp(message.appId));
    case "credentialAvailability":
      return withUserScope(message.userScope, async () => {
        if (!message.accountRefs?.length) return credentialAvailability(message.accountIds, message.userScope);
        const legacyRefs = message.accountRefs.filter((accountRef) => accountRef.vaultId === "legacy-unipass");
        const legacy = await credentialAvailability(legacyRefs.map((accountRef) => accountRef.accountId), message.userScope);
        const extra = await Promise.all(message.accountRefs.filter((accountRef) => accountRef.vaultId !== "legacy-unipass").map(async (accountRef) => ({
          accountId: accountRef.accountId,
          accountRef,
          status: await credentialAvailableForRef(accountRef).then((available) => available ? "available" as const : "empty" as const).catch(() => "error" as const),
        })));
        return [...legacy, ...extra];
      });
    case "revealCredential":
      return withUserScope(message.userScope, async () => {
        advancedCapabilities.require(sender);
        return message.accountRef ? credentialForRef(message.accountRef) : credentialForAccount(message.accountId);
      });
    case "getJupiterKeepalive":
      return withUserScope(message.userScope, () => getJupiterKeepaliveSettings(message.userScope));
    case "setJupiterKeepalive":
      return withUserScope(message.userScope, () => setJupiterKeepalive(message.userScope, message.enabled, message.appId, message.accountId, message.username));
    case "listVaultProfiles":
      return requireVaultManager(sender, listVaultProfiles);
    case "testWebDavConnection":
      return requireVaultManager(sender, () => testWebDavConnection(message));
    case "saveWebDavVault":
      return requireVaultManager(sender, () => saveWebDavVault(message));
    case "removeVault":
      return requireVaultManager(sender, () => removeVault(message.vaultId));
    case "vaultCatalog":
      return requireVaultManager(sender, vaultCatalog);
    case "createVaultApp":
      return requireVaultManager(sender, () => createVaultApp(message.vaultId, message.app));
    case "updateVaultApp":
      return requireVaultManager(sender, () => updateVaultApp(message.vaultId, message.app));
    case "deleteVaultApp":
      return requireVaultManager(sender, () => deleteVaultApp(message.vaultId, message.appId));
    case "createVaultAccount":
      return requireVaultManager(sender, () => createVaultAccount(message.vaultId, message.account));
    case "updateVaultAccount":
      return requireVaultManager(sender, () => updateVaultAccount(message.vaultId, message.account));
    case "deleteVaultAccount":
      return requireVaultManager(sender, () => deleteVaultAccount(message.vaultId, message.accountId));
    case "updateVaultCredential":
      return requireVaultManager(sender, () => updateVaultCredential(message.vaultId, message.accountId, message.credential));
    default:
      return Promise.reject(new Error("不支持的扩展请求"));
  }
}

function requireVaultManager<T>(sender: chrome.runtime.MessageSender, operation: () => Promise<T>): Promise<T> {
  if (!sender.url || !sender.url.endsWith("/manage.html")) return Promise.reject(new Error("Vault 管理请求来源无效"));
  return operation();
}

async function refreshAccountCatalog(): Promise<Awaited<ReturnType<typeof accountCatalog>>> {
  const result = await accountCatalog();
  const webdav = await vaultCatalog();
  const extraEntries = webdav.entries.map(({ app, accounts }) => ({
    appId: app.id,
    appName: app.name,
    appUrl: app.targets[0] ? `https://${app.targets[0].host}${app.targets[0].pathPrefix || "/"}` : "",
    accounts: accounts.map((account) => ({ id: account.id, account: account.username, remark: account.remark, vaultId: account.vaultId, appId: account.appId, accountRef: { vaultId: account.vaultId, accountId: account.id } })),
    vaultId: app.vaultId,
    targets: app.targets,
  }));
  const extraFailures = webdav.failures.map((failure) => ({ appId: failure.vaultId, appName: "WebDAV Vault", error: failure.error, vaultId: failure.vaultId }));
  result.entries.push(...extraEntries);
  result.failures.push(...extraFailures);
  result.complete = result.complete && extraFailures.length === 0;
  await clearCredentialAvailabilityCache();
  return result;
}
