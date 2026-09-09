import type { PageContext, PageTheme, PopupSessionUser, UniPassLoginStartResult } from "../shared/types";
import { send } from "./bridge";
import { CatalogController } from "./catalog";
import { CredentialController } from "./credentials";
import { DomStorage, errorText, get, queryAll, setDomRoot } from "./dom";
import { SettingsController } from "./settings";

const PORTAL_URL = "https://portal.unipass.top/application";
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
  try {
    const user = await send<PopupSessionUser>({ type: "session" });
    identity.textContent = user.fullName || user.name || user.username || user.email || "已登录";
    const nickName = user.nickName?.trim() ?? "";
    if (nickName) identity.title = nickName;
    else identity.removeAttribute("title");
    userScope = catalog.initializeFor(user);
    if (!userScope) setStatus("UniPass 会话缺少稳定用户标识，请联系管理员", true);
    sessionBadge.classList.remove("pending", "offline");
    sessionBadge.classList.add("online");
    sessionBadge.disabled = false;
    if (nickName) sessionBadge.title = nickName;
    else sessionBadge.removeAttribute("title");
    sessionBadge.setAttribute("aria-label", nickName ? `昵称：${nickName}；点击打开 UniPass 应用页` : "点击打开 UniPass 应用页");
  } catch (error) {
    identity.textContent = "一键登录";
    sessionBadge.classList.remove("pending", "online");
    sessionBadge.classList.add("offline");
    sessionBadge.disabled = false;
    sessionBadge.title = "一键登录 UniPass，并授权 Tec-IAM 获取飞书身份标识";
    sessionBadge.setAttribute("aria-label", "一键登录 UniPass，并授权 Tec-IAM 获取飞书身份标识");
    setStatus(errorText(error), true);
  }
    await catalog.loadCurrentPage();
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
    setStatus("正在打开 UniPass 并确认飞书授权");
    void send<UniPassLoginStartResult>({ type: "startUniPassLogin" }).catch((error: unknown) => {
      setStatus(errorText(error), true);
    });
  });
    queryAll<HTMLButtonElement>(".tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view === "apps" ? "apps" : "current")));
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
