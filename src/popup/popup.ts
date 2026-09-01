import type {
  AccountCatalogEntry,
  AccountListResult,
  BackgroundRequest,
  BackgroundResponse,
  Credential,
  CurrentUser,
  FillRequest,
  FillResult,
  UniPassAccount,
  UniPassApp,
  PluginVersionSettings,
  JupiterKeepaliveSettings,
} from "../shared/types";

const PORTAL_URL = "https://portal.unipass.top/application";
const LOGIN_URL = "https://portal.unipass.top/login";
const CREDENTIAL_TTL_SECONDS = 60;

const identity = get("identity");
const sessionBadge = get<HTMLButtonElement>("sessionBadge");
const appsListHeading = get("appsListHeading");
const pageHost = get("pageHost");
const status = get("status");
const currentAccounts = get("currentAccounts");
const appsContainer = get("apps");
const appAccounts = get("appAccounts");
const backToApps = get<HTMLButtonElement>("backToApps");
const credentialPanel = get("credentialPanel");
const credentialUsername = get<HTMLInputElement>("credentialUsername");
const credentialPassword = get<HTMLInputElement>("credentialPassword");
const credentialCountdown = get("credentialCountdown");
const showPassword = get<HTMLInputElement>("showPassword");
const themeToggle = get<HTMLButtonElement>("themeToggle");
const refreshCatalog = get<HTMLButtonElement>("refreshCatalog");
const pluginVersionSettingsButton = get<HTMLButtonElement>("pluginVersionSettingsButton");
const versionSettingsDialog = get("versionSettingsDialog");
const closeVersionSettingsButton = get<HTMLButtonElement>("closeVersionSettings");
const versionForm = get<HTMLFormElement>("versionForm");
const pluginVersionOverride = get<HTMLInputElement>("pluginVersionOverride");
const effectivePluginVersion = get("effectivePluginVersion");
const pluginVersionSource = get("pluginVersionSource");

const THEME_STORAGE_KEY = "unipass-theme";
const ACCOUNT_CATALOG_STORAGE_PREFIX = "unipass-account-catalog-v1:";
const ACCOUNT_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
type Theme = "light" | "dark";
interface CachedAccountCatalog {
  syncedAt: number;
  entries: AccountCatalogEntry[];
}
const systemTheme = window.matchMedia("(prefers-color-scheme: light)");

let currentCredential: Credential | null = null;
let clearTimer: number | undefined;
let countdownTimer: number | undefined;
let clearAt = 0;
let catalogStorageKey: string | null = null;

void initialize();

async function initialize(): Promise<void> {
  bindControls();
  try {
    const user = await send<CurrentUser>({ type: "session" });
    identity.textContent = user.fullName || user.nickName || user.name || user.username || user.email || "已登录";
    catalogStorageKey = accountCatalogStorageKey(user);
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
  await loadCurrentPage();
}

function bindControls(): void {
  applyStoredTheme();
  themeToggle.addEventListener("click", toggleTheme);
  systemTheme.addEventListener("change", () => {
    if (!getStoredTheme()) {
      document.documentElement.dataset.theme = systemTheme.matches ? "light" : "dark";
      updateThemeToggle();
    }
  });
  get<HTMLButtonElement>("openPortal").addEventListener("click", () => {
    window.open(PORTAL_URL, "_blank");
  });
  sessionBadge.addEventListener("click", () => {
    if (!sessionBadge.disabled) window.open(LOGIN_URL, "_blank");
  });
  refreshCatalog.addEventListener("click", () => void refreshCurrentPageCatalog());
  pluginVersionSettingsButton.addEventListener("click", () => void openPluginVersionSettings());
  closeVersionSettingsButton.addEventListener("click", closePluginVersionSettings);
  versionSettingsDialog.addEventListener("click", (event) => {
    if (event.target === versionSettingsDialog) closePluginVersionSettings();
  });
  versionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePluginVersion();
  });
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      switchView(view === "apps" ? "apps" : "current");
    });
  });
  get<HTMLFormElement>("searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    void loadApps(get<HTMLInputElement>("searchInput").value);
  });
  backToApps.addEventListener("click", showAppList);
  get<HTMLButtonElement>("copyUsername").addEventListener("click", () => void copyCredential("username"));
  get<HTMLButtonElement>("copyPassword").addEventListener("click", () => void copyCredential("password"));
  showPassword.addEventListener("change", () => {
    credentialPassword.type = showPassword.checked ? "text" : "password";
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !versionSettingsDialog.classList.contains("hidden")) closePluginVersionSettings();
  });
  window.addEventListener("pagehide", clearCredential);
}

function getStoredTheme(): Theme | null {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
}

function applyStoredTheme(): void {
  document.documentElement.dataset.theme = getStoredTheme() ?? (systemTheme.matches ? "light" : "dark");
  updateThemeToggle();
}

function toggleTheme(): void {
  const nextTheme = getEffectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  updateThemeToggle();
}

function getEffectiveTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ||
    (document.documentElement.dataset.theme !== "dark" && systemTheme.matches)
    ? "light"
    : "dark";
}

function updateThemeToggle(): void {
  const dark = getEffectiveTheme() === "dark";
  const nextLabel = dark ? "切换浅色模式" : "切换深色模式";
  themeToggle.title = nextLabel;
  themeToggle.setAttribute("aria-label", nextLabel);
  themeToggle.dataset.theme = dark ? "dark" : "light";
}
async function loadPluginVersionSettings(): Promise<void> {
  try {
    applyPluginVersionSettings(await send<PluginVersionSettings>({ type: "getPluginVersionSettings" }));
  } catch (error) {
    effectivePluginVersion.textContent = "5.3.0";
    pluginVersionSource.textContent = "暂时无法获取，使用回退版本";
    setStatus(errorText(error), true);
  }
}

function applyPluginVersionSettings(settings: PluginVersionSettings): void {
  pluginVersionOverride.value = settings.override;
  effectivePluginVersion.textContent = settings.effective;
  pluginVersionSource.textContent = settings.source === "manual" ? "手动指定" : settings.source === "store" ? "自动获取" : "网络不可用，回退版本";
}

async function savePluginVersion(): Promise<void> {
  const saveButton = versionForm.querySelector<HTMLButtonElement>("button[type=submit]");
  if (saveButton) saveButton.disabled = true;
  try {
    const settings = await send<PluginVersionSettings>({ type: "setPluginVersionOverride", version: pluginVersionOverride.value });
    applyPluginVersionSettings(settings);
    setStatus("版本设置已保存");
  } catch (error) {
    setStatus(errorText(error), true);
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function loadCurrentPage(): Promise<void> {
  currentAccounts.innerHTML = loading("正在本地匹配账号目录");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error("当前标签页不支持凭据填充");
    pageHost.textContent = new URL(tab.url).hostname;
    let catalog = loadCachedCatalog();
    if (!catalog || Date.now() - catalog.syncedAt > ACCOUNT_CATALOG_TTL_MS) {
      catalog = await syncAccountCatalog();
    }
    await renderAccounts(currentAccounts, accountsForCurrentUrl(catalog.entries, tab.url), tab.id);
  } catch (error) {
    currentAccounts.innerHTML = empty(errorText(error));
  }
}

async function openPluginVersionSettings(): Promise<void> {
  versionSettingsDialog.classList.remove("hidden");
  pluginVersionSettingsButton.setAttribute("aria-expanded", "true");
  pluginVersionOverride.value = "";
  effectivePluginVersion.textContent = "检查中";
  pluginVersionSource.textContent = "";
  pluginVersionOverride.focus();
  await loadPluginVersionSettings();
}

function closePluginVersionSettings(): void {
  versionSettingsDialog.classList.add("hidden");
  pluginVersionSettingsButton.setAttribute("aria-expanded", "false");
  pluginVersionSettingsButton.focus();
}

async function refreshCurrentPageCatalog(): Promise<void> {
  try {
    await syncAccountCatalog();
    await loadCurrentPage();
  } catch (error) {
    currentAccounts.innerHTML = empty(errorText(error));
  }
}

function accountCatalogStorageKey(user: CurrentUser): string {
  const identity = user.username || user.email || user.name || user.nickName || user.fullName || "default";
  return `${ACCOUNT_CATALOG_STORAGE_PREFIX}${identity}`;
}

function loadCachedCatalog(): CachedAccountCatalog | null {
  if (!catalogStorageKey) return null;
  try {
    const value = localStorage.getItem(catalogStorageKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as CachedAccountCatalog;
    if (!Number.isFinite(parsed.syncedAt) || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function syncAccountCatalog(): Promise<CachedAccountCatalog> {
  if (!catalogStorageKey) throw new Error("尚未登录 UniPass");
  refreshCatalog.disabled = true;
  currentAccounts.innerHTML = loading("正在同步账号目录");
  try {
    const entries = await send<AccountCatalogEntry[]>({ type: "accountCatalog" });
    const catalog = { syncedAt: Date.now(), entries };
    localStorage.setItem(catalogStorageKey, JSON.stringify(catalog));
    setStatus("账号目录已同步；当前页仅在本地匹配");
    return catalog;
  } finally {
    refreshCatalog.disabled = false;
  }
}

function accountsForCurrentUrl(entries: AccountCatalogEntry[], currentUrl: string): UniPassAccount[] {
  const target = comparableUrl(currentUrl);
  const targetOrigin = comparableOrigin(currentUrl);
  const accounts: UniPassAccount[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    // App records often store the site root while the active tab is on /login
    // or another route. Prefer an exact match, then accept the same origin.
    if (comparableUrl(entry.appUrl) !== target && comparableOrigin(entry.appUrl) !== targetOrigin) continue;
    for (const account of entry.accounts) {
      const id = account.id ?? account.accountId ?? account.appAccountUserId;
      const key = id == null ? JSON.stringify(account) : String(id);
      if (!seen.has(key)) {
        seen.add(key);
        accounts.push(account);
      }
    }
  }
  return accounts;
}

function comparableUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (!url.hostname.includes("huaban") && !url.hostname.includes("gaoding")) url.search = "";
  return url.toString();
}

function comparableOrigin(value: string): string {
  const url = new URL(value);
  return url.origin.toLowerCase();
}

async function loadApps(keyword = ""): Promise<void> {
  appsContainer.innerHTML = loading("正在加载应用");
  showAppList();
  try {
    const apps = await send<UniPassApp[]>({ type: "listApps", keyword });
    await renderApps(apps);
  } catch (error) {
    appsContainer.innerHTML = empty(errorText(error));
  }
}

async function renderApps(apps: UniPassApp[]): Promise<void> {
  appsContainer.replaceChildren();
  if (!apps.length) {
    appsContainer.innerHTML = empty("未找到应用");
    return;
  }
  const keepalive = await send<JupiterKeepaliveSettings>({ type: "getJupiterKeepalive" });
  for (const app of apps) {
    const title = app.name || app.appName || `应用 ${app.id}`;
    const isJupiter = /木星|jupiter/i.test(title);
    const item = createItem(title, isJupiter && keepalive.enabled && String(keepalive.appId) === String(app.id) ? `保活中 · ${keepalive.username}` : app.favorite ? "已收藏" : "", ["查看账号"]);
    item.buttons[0].addEventListener("click", () => void loadAppAccounts(app));
    const pageLink = createAppPageLink(app);
    item.root.querySelector<HTMLElement>(".item-meta")?.replaceChildren(pageLink);
    if (isJupiter) {
      const isEnabled = keepalive.enabled && String(keepalive.appId) === String(app.id);
      const keepaliveButton = button(isEnabled ? "关闭托管" : "自动托管", isEnabled ? "keepalive-enabled" : "");
      keepaliveButton.title = "每 25 分钟重新登录木星以保持会话";
      keepaliveButton.addEventListener("click", () => void toggleJupiterKeepalive(app, isEnabled, keepaliveButton));
      item.root.querySelector<HTMLElement>(".actions")?.prepend(keepaliveButton);
    }
    appsContainer.append(item.root);
  }
}


function createAppPageLink(app: UniPassApp): HTMLButtonElement {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "item-meta-link";
  link.title = "打开应用页面";
  link.append(document.createTextNode("打开页面"));
  link.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>');
  link.addEventListener("click", () => void openAppPage(app));
  return link;
}

async function toggleJupiterKeepalive(app: UniPassApp, enabled: boolean, control: HTMLButtonElement): Promise<void> {
  control.disabled = true;
  try {
    if (enabled) {
      await send<JupiterKeepaliveSettings>({ type: "setJupiterKeepalive", enabled: false });
      setStatus("木星应用保活已关闭");
    } else {
      const result = await send<JupiterKeepaliveSettings>({ type: "setJupiterKeepalive", enabled: true, appId: app.id });
      setStatus(result.lastError ? `木星保活已开启，但首次续期失败：${result.lastError}` : "木星应用保活已开启");
    }
    await loadApps(get<HTMLInputElement>("searchInput").value);
  } catch (error) {
    setStatus(errorText(error), true);
  } finally {
    control.disabled = false;
  }
}

async function openAppPage(app: UniPassApp): Promise<void> {
  try {
    setStatus("正在获取应用地址");
    const appUrl = await send<string>({ type: "appUrl", appId: app.id });
    await chrome.tabs.create({ url: appUrl });
    setStatus("已打开应用页面");
  } catch (error) {
    setStatus(errorText(error), true);
  }
}

async function loadAppAccounts(app: UniPassApp): Promise<void> {
  appsContainer.classList.add("hidden");
  appsListHeading.classList.add("hidden");
  backToApps.classList.remove("hidden");
  appAccounts.classList.remove("hidden");
  appAccounts.innerHTML = loading("正在加载账号");
  try {
    const result = await send<AccountListResult>({ type: "accountsForApp", appId: app.id });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await renderAccounts(appAccounts, result.accounts, tab?.id);
  } catch (error) {
    appAccounts.innerHTML = empty(errorText(error));
  }
}

async function renderAccounts(container: HTMLElement, accounts: UniPassAccount[], tabId?: number): Promise<void> {
  const availableAccounts = (await Promise.all(accounts.map(async (account) => {
    const accountId = account.id ?? account.accountId ?? account.appAccountUserId;
    if (accountId == null) return null;
    const username = account.account || account.phoneNumber || account.email || "未命名账号";
    try {
      const credential = await send<Credential>({ type: "credential", accountId, fallbackUsername: username });
      const hasPassword = credential.password.trim().length > 0;
      credential.password = "";
      return hasPassword ? account : null;
    } catch (error) {
      // Keep accounts visible when the availability check itself fails; only hide known empty-password records.
      const message = errorText(error);
      return /没有可用密码|密码解密失败/.test(message) ? null : account;
    }
  }))).filter((account): account is UniPassAccount => account != null);
  if (!availableAccounts.length) {
    container.innerHTML = empty("没有可用账号");
    return;
  }
  container.replaceChildren();
  for (const account of availableAccounts) {
    const accountId = account.id ?? account.accountId ?? account.appAccountUserId;
    if (accountId == null) continue;
    const username = account.account || account.phoneNumber || account.email || "未命名账号";
    const root = document.createElement("article");
    root.className = "item account-item";
    const icon = accountIcon();
    const main = document.createElement("div");
    main.className = "item-main";
    main.append(textElement("div", "item-title", username), textElement("div", "item-meta", account.remark || (account.topPriority ? "优先账号" : "无备注")));
    const actions = document.createElement("div");
    actions.className = "actions";
    const fillButton = button("填入", "primary");
    fillButton.disabled = tabId == null;
    fillButton.addEventListener("click", () => void fillAccount(tabId, accountId, username));
    const viewButton = button("查看");
    viewButton.addEventListener("click", () => void revealAccount(accountId, username));
    actions.append(fillButton, viewButton);
    root.append(icon, main, actions);
    container.append(root);
  }
}
async function revealAccount(accountId: string | number, username: string): Promise<void> {
  try {
    setStatus("正在获取凭据");
    const credential = await send<Credential>({ type: "credential", accountId, fallbackUsername: username });
    showCredential(credential);
    setStatus("凭据只保留在当前弹窗内存中");
  } catch (error) {
    setStatus(errorText(error), true);
  }
}

async function fillAccount(tabId: number | undefined, accountId: string | number, username: string): Promise<void> {
  if (tabId == null) return;
  let credential: Credential | null = null;
  try {
    setStatus("正在填入当前页面");
    credential = await send<Credential>({ type: "credential", accountId, fallbackUsername: username });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/content-script.js"] });
    const result = await chrome.tabs.sendMessage<FillRequest, FillResult>(tabId, {
      type: "fillCredentials",
      credential,
      mode: "all",
    });
    if (!result?.ok) throw new Error(result?.error || "填充失败");
    setStatus(result.usernameFilled ? "账号和密码已填入，未自动提交" : "密码已填入；未找到账号输入框");
  } catch (error) {
    setStatus(errorText(error), true);
  } finally {
    if (credential) credential.password = "";
  }
}

function showCredential(credential: Credential): void {
  clearCredential();
  currentCredential = credential;
  credentialUsername.value = credential.username;
  credentialPassword.value = credential.password;
  credentialPassword.type = "password";
  showPassword.checked = false;
  credentialPanel.classList.remove("hidden");
  clearAt = Date.now() + CREDENTIAL_TTL_SECONDS * 1000;
  updateCountdown();
  countdownTimer = window.setInterval(updateCountdown, 1000);
  clearTimer = window.setTimeout(clearCredential, CREDENTIAL_TTL_SECONDS * 1000);
}

function clearCredential(): void {
  if (currentCredential) currentCredential.password = "";
  currentCredential = null;
  credentialUsername.value = "";
  credentialPassword.value = "";
  credentialPassword.type = "password";
  showPassword.checked = false;
  credentialPanel.classList.add("hidden");
  if (clearTimer) window.clearTimeout(clearTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
  clearTimer = undefined;
  countdownTimer = undefined;
}

function updateCountdown(): void {
  const seconds = Math.max(0, Math.ceil((clearAt - Date.now()) / 1000));
  credentialCountdown.textContent = `${seconds} 秒后清除`;
}

async function copyCredential(field: keyof Credential): Promise<void> {
  const value = currentCredential?.[field];
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus(field === "password" ? "密码已复制" : "账号已复制");
  } catch {
    setStatus("浏览器拒绝写入剪贴板", true);
  }
}

function switchView(view: "current" | "apps"): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  get("currentView").classList.toggle("hidden", view !== "current");
  get("appsView").classList.toggle("hidden", view !== "apps");
  if (view === "apps" && !appsContainer.childElementCount) void loadApps();
}

function showAppList(): void {
  appsContainer.classList.remove("hidden");
  appsListHeading.classList.remove("hidden");
  backToApps.classList.add("hidden");
  appAccounts.classList.add("hidden");
  appAccounts.replaceChildren();
}

function createItem(title: string, meta: string, actions: string[]): { root: HTMLElement; buttons: HTMLButtonElement[] } {
  const root = document.createElement("article");
  root.className = "item";
  const icon = document.createElement("span");
  icon.className = "item-icon";
  icon.textContent = title.trim().charAt(0) || "A";
  icon.setAttribute("aria-hidden", "true");
  const main = document.createElement("div");
  main.className = "item-main";
  main.append(textElement("div", "item-title", title), textElement("div", "item-meta", meta || "UniPass 应用"));
  const actionContainer = document.createElement("div");
  actionContainer.className = "actions";
  const actionButtons = actions.map((action, index) => button(action, index === 0 ? "primary" : ""));
  actionContainer.append(...actionButtons);
  root.append(icon, main, actionContainer);
  return { root, buttons: actionButtons };
}

function accountIcon(): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>';
  return icon;
}

function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

function loading(text: string): string {
  return `<div class="empty loading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-5.3-7.5" /></svg><span>${escapeHtml(text)}</span></div>`;
}
function empty(text: string): string {
  return `<div class="empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5h14v11H5zM8 7.5V5h8v2.5M9 12h6" /></svg><span>${escapeHtml(text)}</span></div>`;
}
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function send<T>(message: BackgroundRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<BackgroundRequest, BackgroundResponse<T>>(message);
  if (!response?.ok) throw new Error(response?.error || "扩展后台没有响应");
  return response.data;
}

function get<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}
