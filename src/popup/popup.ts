import type { CurrentUser } from "../shared/types";
import { send } from "./bridge";
import { CatalogController } from "./catalog";
import { CredentialController } from "./credentials";
import { errorText, get } from "./dom";
import { SettingsController } from "./settings";

const PORTAL_URL = "https://portal.unipass.top/application";
const LOGIN_URL = "https://portal.unipass.top/login";
const identity = get("identity");
const sessionBadge = get<HTMLButtonElement>("sessionBadge");
const status = get("status");
const apps = get("apps");
const settings = new SettingsController(setStatus);
const credentials = new CredentialController(setStatus);
const catalog = new CatalogController(setStatus, (id, username) => credentials.reveal(id, username), (tabId, id, username, appUrl) => credentials.fill(tabId, id, username, appUrl));

void initialize();

async function initialize(): Promise<void> {
  settings.bind();
  credentials.bind();
  catalog.bind();
  bindControls();
  try {
    const user = await send<CurrentUser>({ type: "session" });
    identity.textContent = user.fullName || user.nickName || user.name || user.username || user.email || "已登录";
    catalog.initializeFor(user);
    sessionBadge.classList.remove("pending", "offline");
    sessionBadge.classList.add("online");
    sessionBadge.disabled = true;
    sessionBadge.title = "UniPass 登录状态";
  } catch (error) {
    identity.textContent = "点击登录";
    sessionBadge.classList.remove("pending", "online");
    sessionBadge.classList.add("offline");
    sessionBadge.disabled = false;
    sessionBadge.title = "登录 UniPass";
    setStatus(errorText(error), true);
  }
  await catalog.loadCurrentPage();
}

function bindControls(): void {
  get<HTMLButtonElement>("openPortal").addEventListener("click", () => window.open(PORTAL_URL, "_blank"));
  sessionBadge.addEventListener("click", () => { if (!sessionBadge.disabled) window.open(LOGIN_URL, "_blank"); });
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view === "apps" ? "apps" : "current")));
}

function switchView(view: "current" | "apps"): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  get("currentView").classList.toggle("hidden", view !== "current");
  get("appsView").classList.toggle("hidden", view !== "apps");
  if (view === "apps" && !apps.childElementCount) void catalog.loadApps();
}

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}
