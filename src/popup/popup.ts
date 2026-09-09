import type { PageContext, PageTheme, PopupSessionUser, UniPassLoginStartResult } from "../shared/types";
import { send } from "./bridge";
import { CatalogController } from "./catalog";
import { CredentialController } from "./credentials";
import { DomStorage, errorText, get, queryAll, setDomRoot } from "./dom";
import { SettingsController } from "./settings";

const PORTAL_URL = "https://portal.unipass.top/application";
const LOGIN_REFRESH_INTERVAL_MS = 1_000;
const LOGIN_REFRESH_WINDOW_MS = 2 * 60 * 1_000;
export interface PopupEnvironment {
  root?: Document | ShadowRoot;
  storage?: DomStorage;
  pageContext?: () => Promise<PageContext>;
  openApp?: (appId: string | number, userScope: string) => Promise<void>;
  overlay?: boolean;
  themeTarget?: HTMLElement;
}

export function initializePopup(environment: PopupEnvironment = {}): void {
  setDomRoot(environment.root ?? document);
  const identity = get("identity");
  const sessionBadge = get<HTMLButtonElement>("sessionBadge");
  const status = get("status");
  const apps = get("apps");
  let userScope: string | null = null;
  let loginRefreshTimer: number | undefined;
  let loginRefreshDeadline = 0;
  const setStatus = (text: string, isError = false): void => {
    status.textContent = text;
    status.classList.toggle("error", isError);
  };
  const settings = new SettingsController(setStatus, environment.storage, environment.themeTarget ?? (environment.root instanceof ShadowRoot ? environment.root.host as HTMLElement : document.documentElement));
  const credentials = new CredentialController(setStatus, () => userScope, environment.overlay);
  const catalog = new CatalogController(
    setStatus,
    (id, username) => credentials.reveal(id, username),
    (tabId, id, username, appUrl) => credentials.fill(tabId, id, username, appUrl),
    environment.pageContext,
    environment.openApp,
    environment.storage,
  );
  void initialize();

  async function initialize(): Promise<void> {
    settings.bind();
    await applyPageTheme();
    credentials.bind();
    catalog.bind();
    bindControls();
    await refreshSession();
    await catalog.loadCurrentPage();
  }

  async function refreshSession(): Promise<void> {
    try {
      const user = await send<PopupSessionUser>({ type: "session" });
      applyOnlineSession(user);
    } catch (error) {
      applyOfflineSession(error);
    }
  }

  function applyOnlineSession(user: PopupSessionUser): void {
    identity.textContent = user.fullName || user.name || user.username || user.email || "已登录";
    const nickName = user.nickName?.trim() ?? "";
    if (nickName) identity.title = nickName;
    else identity.removeAttribute("title");
    userScope = catalog.initializeFor(user);
    if (!userScope) setStatus("UniPass 会话缺少稳定用户标识，请联系管理员", true);
    sessionBadge.classList.remove("pending", "offline", "logging-in");
    sessionBadge.classList.add("online");
    sessionBadge.disabled = false;
    if (nickName) sessionBadge.title = nickName;
    else sessionBadge.removeAttribute("title");
    sessionBadge.setAttribute("aria-label", nickName ? `昵称：${nickName}；点击打开 UniPass 应用页` : "点击打开 UniPass 应用页");
  }

  function applyOfflineSession(error: unknown): void {
    identity.textContent = "一键登录";
    sessionBadge.classList.remove("pending", "online", "logging-in");
    sessionBadge.classList.add("offline");
    sessionBadge.disabled = false;
    sessionBadge.title = "一键登录 UniPass，并授权 Tec-IAM 获取飞书身份标识";
    sessionBadge.setAttribute("aria-label", "一键登录 UniPass，并授权 Tec-IAM 获取飞书身份标识");
    setStatus(errorText(error), true);
  }

  async function applyPageTheme(): Promise<void> {
    try {
      const theme = await send<PageTheme>({ type: "pageTheme" });
      settings.applyAutoTheme(theme);
    } catch {
      // Browser-internal pages and pages that reject injection use the stored/system theme.
    }
  }

  function bindControls(): void {
    sessionBadge.addEventListener("click", () => {
      if (sessionBadge.classList.contains("online")) {
        window.open(PORTAL_URL, "_blank");
        return;
      }
      beginLoginRefresh();
      void send<UniPassLoginStartResult>({ type: "startUniPassLogin" }).catch((error: unknown) => {
        stopLoginRefresh();
        applyOfflineSession(error);
      });
    });
    queryAll<HTMLButtonElement>(".tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view === "apps" ? "apps" : "current")));
  }

  function beginLoginRefresh(): void {
    stopLoginRefresh();
    loginRefreshDeadline = Date.now() + LOGIN_REFRESH_WINDOW_MS;
    identity.textContent = "登录中";
    sessionBadge.classList.remove("pending", "online", "offline");
    sessionBadge.classList.add("logging-in");
    sessionBadge.disabled = true;
    sessionBadge.title = "正在后台登录并确认 UniPass 会话";
    sessionBadge.setAttribute("aria-label", "正在后台登录并确认 UniPass 会话");
    setStatus("正在后台登录，等待 UniPass 会话确认");
    void refreshLoginSession();
  }

  async function refreshLoginSession(): Promise<void> {
    if (!sessionBadge.isConnected) return;
    try {
      const user = await send<PopupSessionUser>({ type: "session" });
      stopLoginRefresh();
      void send<void>({ type: "completeUniPassLogin" });
      applyOnlineSession(user);
      setStatus("登录成功，账号目录已刷新");
      await catalog.loadCurrentPage();
      return;
    } catch {
      if (!sessionBadge.isConnected || Date.now() >= loginRefreshDeadline) {
        stopLoginRefresh();
        applyOfflineSession(new Error("登录尚未完成，请检查后台认证页面后重试"));
        return;
      }
      loginRefreshTimer = window.setTimeout(() => void refreshLoginSession(), LOGIN_REFRESH_INTERVAL_MS);
    }
  }

  function stopLoginRefresh(): void {
    if (loginRefreshTimer != null) window.clearTimeout(loginRefreshTimer);
    loginRefreshTimer = undefined;
    loginRefreshDeadline = 0;
  }

  function switchView(view: "current" | "apps"): void {
    queryAll<HTMLButtonElement>(".tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    });
  get("currentView").classList.toggle("hidden", view !== "current");
  get("appsView").classList.toggle("hidden", view !== "apps");
  if (view === "apps" && !apps.childElementCount) void catalog.loadApps();
  }
}

if (document.querySelector(".app-window")) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initializePopup());
  else initializePopup();
}
