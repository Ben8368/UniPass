import { isTrustedFeishuAuthorizationUrl, isUniPassLoginUrl } from "../shared/url";
import type { UniPassLoginStartResult } from "../shared/types";

const PORTAL_LOGIN_URL = "https://portal.unipass.top/login";
const PORTAL_ORIGIN = "https://portal.unipass.top";
const FEISHU_ORIGIN = "https://accounts.feishu.cn";
const TEC_IAM_ORIGIN = "https://tec-iam.tec-do.com";
const PENDING_LOGIN_KEY = "pendingUniPassLogin";
const LOGIN_WINDOW_MS = 2 * 60 * 1000;

interface PendingLogin {
  tabId: number;
  expiresAt: number;
  phase: "portal" | "feishu";
}

const processingTabs = new Set<number>();
const queuedTabUrls = new Map<number, string | undefined>();

export async function startUniPassLogin(): Promise<UniPassLoginStartResult> {
  const pending = await readPendingLogin();
  if (pending) {
    try {
      await chrome.tabs.update(pending.tabId, { active: true });
      void processUniPassLoginTab(pending.tabId).catch((error: unknown) => {
        console.warn("UniPass 登录页处理失败", error);
      });
      return { tabId: pending.tabId };
    } catch (error: unknown) {
      if (!isMissingTabError(error)) throw error;
      await clearPendingLogin();
    }
  }

  const loginTabs = await chrome.tabs.query({ url: `${PORTAL_LOGIN_URL}*` });
  const existing = loginTabs.find((tab) => tab.id != null && tab.url != null && isUniPassLoginUrl(tab.url));
  const tab = existing?.id != null
    ? await chrome.tabs.update(existing.id, { active: true })
    : await chrome.tabs.create({ url: PORTAL_LOGIN_URL, active: true });
  if (!tab || tab.id == null) throw new Error("无法打开 UniPass 登录页");

  await chrome.storage.session.set({
    [PENDING_LOGIN_KEY]: { tabId: tab.id, expiresAt: Date.now() + LOGIN_WINDOW_MS, phase: "portal" } satisfies PendingLogin,
  });
  // A new tab can report "loading" before the session state above is visible. Start now so it is never held until "complete".
  void processUniPassLoginTab(tab.id, tab.url).catch((error: unknown) => {
    console.warn("UniPass 登录页处理失败", error);
  });
  return { tabId: tab.id };
}

export async function processUniPassLoginTab(tabId: number, reportedUrl?: string): Promise<void> {
  if (processingTabs.has(tabId)) {
    queuedTabUrls.set(tabId, reportedUrl);
    return;
  }
  processingTabs.add(tabId);
  try {
    const pending = await readPendingLogin();
    if (!pending || pending.tabId !== tabId) return;

    const tab = reportedUrl ? undefined : await chrome.tabs.get(tabId);
    const url = reportedUrl ?? tab?.url;
    if (!url) return;

    if (isUniPassLoginUrl(url)) {
      if (pending.phase !== "portal") return;
      const [{ result: clicked } = { result: false }] = await chrome.scripting.executeScript({ target: { tabId }, func: clickTecDoLoginButton, injectImmediately: true });
      if (clicked) await setPendingLoginPhase(tabId, "feishu");
      return;
    }
    if (isTrustedFeishuAuthorizationUrl(url)) {
      await setPendingLoginPhase(tabId, "feishu");
      const [{ result: clicked } = { result: false }] = await chrome.scripting.executeScript({ target: { tabId }, func: clickTrustedFeishuAuthorizeButton, injectImmediately: true });
      if (clicked) await clearPendingLogin(tabId);
      return;
    }

    const origin = safeOrigin(url);
    if (origin === PORTAL_ORIGIN) await clearPendingLogin(tabId);
    else if (origin !== FEISHU_ORIGIN && origin !== TEC_IAM_ORIGIN) await clearPendingLogin(tabId);
  } catch (error: unknown) {
    if (isMissingTabError(error)) await clearPendingLogin(tabId);
    else throw error;
  } finally {
    processingTabs.delete(tabId);
    if (queuedTabUrls.has(tabId)) {
      const queuedUrl = queuedTabUrls.get(tabId);
      queuedTabUrls.delete(tabId);
      void processUniPassLoginTab(tabId, queuedUrl);
    }
  }
}

export async function clearUniPassLoginForTab(tabId: number): Promise<void> {
  await clearPendingLogin(tabId);
}

async function readPendingLogin(): Promise<PendingLogin | null> {
  const pending = await readPendingLoginWithoutExpiry();
  if (!pending) return null;
  if (pending.expiresAt <= Date.now()) {
    await clearPendingLogin();
    return null;
  }
  return pending;
}

async function clearPendingLogin(expectedTabId?: number): Promise<void> {
  if (expectedTabId != null) {
    const pending = await readPendingLoginWithoutExpiry();
    if (!pending || pending.tabId !== expectedTabId) return;
  }
  await chrome.storage.session.remove(PENDING_LOGIN_KEY);
}

async function setPendingLoginPhase(tabId: number, phase: PendingLogin["phase"]): Promise<void> {
  const pending = await readPendingLogin();
  if (!pending || pending.tabId !== tabId || pending.phase === phase) return;
  await chrome.storage.session.set({ [PENDING_LOGIN_KEY]: { ...pending, phase } satisfies PendingLogin });
}

async function readPendingLoginWithoutExpiry(): Promise<PendingLogin | null> {
  const stored = await chrome.storage.session.get(PENDING_LOGIN_KEY);
  const value = stored[PENDING_LOGIN_KEY] as Partial<PendingLogin> | undefined;
  return value && typeof value.tabId === "number" && typeof value.expiresAt === "number" && (value.phase === "portal" || value.phase === "feishu")
    ? { tabId: value.tabId, expiresAt: value.expiresAt, phase: value.phase }
    : null;
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function isMissingTabError(error: unknown): boolean {
  return /no tab with id/i.test(error instanceof Error ? error.message : String(error));
}

async function clickTecDoLoginButton(): Promise<boolean> {
  if (location.origin !== "https://portal.unipass.top" || location.pathname.replace(/\/+$/, "") !== "/login" || location.search) return false;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const matches = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.trim() === "钛动科技" && !button.disabled && button.offsetParent !== null);
    if (matches.length === 1) {
      matches[0].click();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function clickTrustedFeishuAuthorizeButton(): Promise<boolean> {
  const url = new URL(location.href);
  const trusted = url.origin === "https://accounts.feishu.cn"
    && url.pathname.replace(/\/+$/, "") === "/accounts/auth_login/oauth2/authorize"
    && url.searchParams.get("response_type") === "code"
    && url.searchParams.get("client_id") === "cli_aae6da4f6538dbed"
    && url.searchParams.get("redirect_uri") === "https://tec-iam.tec-do.com/portal/api/v1/login/feishu_oauth/gboh9uvzolazw62gmxojwaarust5qyvh"
    && Boolean(url.searchParams.get("state"));
  if (!trusted) return false;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (document.body?.innerText.includes("钛动身份认证中心（Tec-IAM）") && document.body.innerText.includes("获取用户身份标识")) {
      const matches = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .filter((button) => button.textContent?.trim() === "授权" && !button.disabled && button.offsetParent !== null);
      if (matches.length === 1) {
        matches[0].click();
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
