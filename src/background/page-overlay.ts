import { appUrlForApp, credentialForAccount } from "../shared/api";
import { appUrlMatches, isHttpsUrl } from "../shared/url";
import type { FillRequest, FillResult, PageContext, PageTheme } from "../shared/types";
import { detectPageTheme } from "../shared/page-theme";

export async function pageContextFor(sender: chrome.runtime.MessageSender): Promise<PageContext> {
  const tab = sender.tab;
  if (tab?.id == null || !tab.url) throw new Error("无法识别当前页面");
  return { tabId: tab.id, url: tab.url };
}

export async function pageThemeFor(sender: chrome.runtime.MessageSender): Promise<PageTheme> {
  const tab = sender.tab?.id != null ? sender.tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !tab.url || !isHttpsUrl(tab.url)) return "light";
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: detectPageTheme });
    return result?.result === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export async function openApp(appId: string | number): Promise<void> {
  await chrome.tabs.create({ url: await appUrlForApp(appId) });
}

export async function togglePageOverlay(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isHttpsUrl(tab.url)) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/page-overlay.js"] });
}

export async function configureActionPopup(tabId: number, url?: string): Promise<void> {
  await chrome.action.setPopup({ tabId, popup: url && isHttpsUrl(url) ? "" : "popup.html" });
}

export async function fillFromOverlay(
  sender: chrome.runtime.MessageSender,
  message: Extract<import("../shared/types").BackgroundRequest, { type: "fillFromOverlay" }>,
): Promise<FillResult> {
  const tabId = sender.tab?.id;
  if (tabId == null) throw new Error("无法确认当前页面");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !tab.url || !isHttpsUrl(tab.url) || !appUrlMatches(message.expectedAppUrl, tab.url)) {
    return { ok: false, usernameFilled: false, passwordFilled: false, error: "当前标签页已切换或不属于该应用，已取消填充" };
  }
  let credential: { username: string; password: string } | null = null;
  try {
    credential = await credentialForAccount(message.accountId, message.fallbackUsername);
    const current = await chrome.tabs.get(tabId);
    if (!current.active || !current.url || !appUrlMatches(message.expectedAppUrl, current.url)) {
      return { ok: false, usernameFilled: false, passwordFilled: false, error: "获取凭据期间标签页已切换或离开该应用，已取消填充" };
    }
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, files: ["content/content-script.js"] });
    if (!injection?.documentId) throw new Error("无法确认凭据填充页面");
    return await chrome.tabs.sendMessage<FillRequest, FillResult>(tabId, {
      type: "fillCredentials",
      credential,
      expectedAppUrl: message.expectedAppUrl,
      mode: "all",
    }, { documentId: injection.documentId });
  } finally {
    if (credential) credential.password = "";
  }
}
