import type { AccountCatalogEntry, AccountCatalogResult, AccountListResult, CredentialAvailabilityResult, CurrentUser, JupiterKeepaliveSettings, PageContext, UniPassAccount, UniPassApp } from "../shared/types";
import { appUrlMatches, isHttpsUrl } from "../shared/url";
import { userScopeFor } from "../shared/user-scope";
import { send } from "./bridge";
import { accountIcon, button, empty, errorText, get, loading, textElement } from "./dom";
import type { DomStorage } from "./dom";

const PREFIX = "unipass-account-catalog-v3:";
const LEGACY_PREFIXES = ["unipass-account-catalog-v1:", "unipass-account-catalog-v2:"];
const TTL_MS = 24 * 60 * 60 * 1000;
interface CachedCatalog { syncedAt: number; entries: AccountCatalogEntry[]; }

export class CatalogController {
  private readonly currentAccounts = get("currentAccounts");
  private readonly apps = get("apps");
  private readonly appAccounts = get("appAccounts");
  private readonly heading = get("appsListHeading");
  private readonly back = get<HTMLButtonElement>("backToApps");
  private readonly refresh = get<HTMLButtonElement>("refreshCatalog");
  private readonly pageHost = get("pageHost");
  private storageKey: string | null = null;
  private userScope: string | null = null;

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly reveal: (accountId: string | number) => Promise<void>,
    private readonly fill: (tabId: number | undefined, accountId: string | number, appUrl?: string) => Promise<void>,
    private readonly getPageContext?: () => Promise<PageContext>,
    private readonly openApp?: (appId: string | number, userScope: string) => Promise<void>,
    private readonly storage: DomStorage = window.localStorage,
    private readonly isAdvancedModeEnabled: () => boolean = () => false,
  ) {}

  bind(): void {
    this.refresh.addEventListener("click", () => void this.refreshCurrentPage());
    get<HTMLFormElement>("searchForm").addEventListener("submit", (event) => { event.preventDefault(); void this.loadApps(get<HTMLInputElement>("searchInput").value); });
    this.back.addEventListener("click", () => this.showAppList());
  }

  refreshForAdvancedModeChange(): void {
    void this.loadCurrentPage();
  }

  initializeFor(user: CurrentUser): string | null {
    const stableScope = userScopeFor(user);
    this.userScope = stableScope;
    this.storageKey = stableScope ? `${PREFIX}${stableScope}` : null;
    for (let i = this.storage.length - 1; i >= 0; i -= 1) {
      const key = this.storage.key(i);
      if (key && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) this.storage.removeItem(key);
    }
    return this.userScope;
  }

  hasApps(): boolean { return this.apps.childElementCount > 0; }

  async loadCurrentPage(override?: CachedCatalog): Promise<void> {
    this.currentAccounts.innerHTML = loading("正在本地匹配账号目录");
    try {
      const tab = await this.getTabContext();
      if (!tab?.tabId || !tab.url || !isHttpsUrl(tab.url)) throw new Error("为保护凭据安全，仅支持 HTTPS 页面填充");
      this.pageHost.textContent = new URL(tab.url).hostname;
      let catalog = override ?? this.loadCached();
      if (!override && (!catalog || Date.now() - catalog.syncedAt > TTL_MS)) catalog = await this.sync();
      if (!catalog) throw new Error("账号目录不可用，请重新同步");
      await this.renderAccounts(this.currentAccounts, this.accountsForUrl(catalog.entries, tab.url), tab.tabId, tab.url);
    } catch (error) {
      this.currentAccounts.innerHTML = empty(errorText(error));
    }
  }

  async loadApps(keyword = ""): Promise<void> {
    this.apps.innerHTML = loading("正在加载应用");
    this.showAppList();
    try { await this.renderApps(await send<UniPassApp[]>({ type: "listApps", keyword, userScope: this.requireUserScope() })); }
    catch (error) { this.apps.innerHTML = empty(errorText(error)); }
  }

  private async refreshCurrentPage(): Promise<void> {
    try { await this.loadCurrentPage(await this.sync()); }
    catch (error) { this.currentAccounts.innerHTML = empty(errorText(error)); }
  }

  private loadCached(): CachedCatalog | null {
    if (!this.storageKey) return null;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedCatalog;
      return Number.isFinite(parsed.syncedAt) && Array.isArray(parsed.entries) ? parsed : null;
    } catch { return null; }
  }

  private async sync(): Promise<CachedCatalog> {
    if (!this.userScope) throw new Error("尚未登录 UniPass");
    this.refresh.disabled = true;
    this.currentAccounts.innerHTML = loading("正在同步账号目录");
    try {
      const result = await send<AccountCatalogResult>({ type: "accountCatalog", userScope: this.requireUserScope() });
      if (result.complete) {
        const catalog = { syncedAt: Date.now(), entries: result.entries };
        if (this.storageKey) this.storage.setItem(this.storageKey, JSON.stringify(catalog));
        this.reportStatus("账号目录已同步；当前页仅在本地匹配");
        return catalog;
      }
      const previous = this.loadCached();
      this.reportStatus(`有 ${result.failures.length} 个应用同步失败，${previous ? "继续使用上次完整目录" : "本次结果不会缓存"}`, true);
      return previous ?? { syncedAt: 0, entries: result.entries };
    } finally { this.refresh.disabled = false; }
  }

  private accountsForUrl(entries: AccountCatalogEntry[], url: string): UniPassAccount[] {
    const seen = new Set<string>();
    return entries.flatMap((entry) => appUrlMatches(entry.appUrl, url) ? entry.accounts : []).filter((account) => {
      const id = account.id ?? account.accountId ?? account.appAccountUserId;
      const key = id == null ? JSON.stringify(account) : String(id);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  private async renderApps(apps: UniPassApp[]): Promise<void> {
    this.apps.replaceChildren();
    if (!apps.length) { this.apps.innerHTML = empty("未找到应用"); return; }
    const keepalive = await send<JupiterKeepaliveSettings>({ type: "getJupiterKeepalive", userScope: this.requireUserScope() });
    for (const app of apps) {
      const title = app.name || app.appName || `应用 ${app.id}`;
      const isJupiter = /木星|jupiter/i.test(title);
      const root = document.createElement("article"); root.className = "item app-item";
      const main = document.createElement("div"); main.className = "item-main";
      main.append(textElement("div", "item-title", title));
      const actions = document.createElement("div"); actions.className = "actions";
      const open = button("打开页面"); open.title = "打开应用页面"; open.setAttribute("aria-label", `打开${title}页面`); open.addEventListener("click", () => void this.openAppPage(app)); actions.append(open);
      if (isJupiter) { const enabled = keepalive.enabled && String(keepalive.appId) === String(app.id); const control = button(enabled ? "关闭托管" : "自动托管", enabled ? "primary keepalive-enabled" : ""); control.title = "每 25 分钟后台提交登录请求以保持会话，不刷新当前页面"; control.addEventListener("click", () => void this.toggleKeepalive(app, enabled, control)); actions.prepend(control); }
      root.append(this.appIcon(title, app), main, actions); this.apps.append(root);
    }
  }

  private appIcon(title: string, app: UniPassApp): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "app-icon-slot";
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "item-icon app-icon-button";
    icon.textContent = title.trim().charAt(0) || "A";
    icon.title = "查看应用账号";
    icon.setAttribute("aria-label", `查看${title}账号`);
    icon.addEventListener("click", () => {
      if (this.isAdvancedModeEnabled()) void this.loadAppAccounts(app);
    });
    slot.append(icon);
    return slot;
  }

  private async toggleKeepalive(app: UniPassApp, enabled: boolean, control: HTMLButtonElement): Promise<void> {
    control.disabled = true;
    try {
      if (enabled) { await send<JupiterKeepaliveSettings>({ type: "setJupiterKeepalive", enabled: false, userScope: this.requireUserScope() }); this.reportStatus("木星应用保活已关闭"); }
      else { const result = await send<JupiterKeepaliveSettings>({ type: "setJupiterKeepalive", enabled: true, userScope: this.requireUserScope(), appId: app.id }); this.reportStatus(result.lastError ? `木星保活已开启，但首次续期失败：${result.lastError}` : "木星应用保活已开启"); }
      await this.loadApps(get<HTMLInputElement>("searchInput").value);
    } catch (error) { this.reportStatus(errorText(error), true); } finally { control.disabled = false; }
  }

  private async openAppPage(app: UniPassApp): Promise<void> {
    try {
      this.reportStatus("正在获取应用地址");
      if (this.openApp) await this.openApp(app.id, this.requireUserScope());
      else await chrome.tabs.create({ url: await send<string>({ type: "appUrl", appId: app.id, userScope: this.requireUserScope() }) });
      this.reportStatus("已打开应用页面");
    }
    catch (error) { this.reportStatus(errorText(error), true); }
  }

  private async loadAppAccounts(app: UniPassApp): Promise<void> {
    this.apps.classList.add("hidden"); this.heading.classList.add("hidden"); this.back.classList.remove("hidden"); this.appAccounts.classList.remove("hidden"); this.appAccounts.innerHTML = loading("正在加载账号");
    try { const result = await send<AccountListResult>({ type: "accountsForApp", appId: app.id, userScope: this.requireUserScope() }); const tab = await this.getTabContext(); const id = tab?.tabId != null && tab.url && appUrlMatches(result.appUrl, tab.url) ? tab.tabId : undefined; await this.renderAccounts(this.appAccounts, result.accounts, id, result.appUrl); }
    catch (error) { this.appAccounts.innerHTML = empty(errorText(error)); }
  }

  private async renderAccounts(container: HTMLElement, accounts: UniPassAccount[], tabId?: number, appUrl?: string): Promise<void> {
    const candidates = accounts.filter((account) => (account.id ?? account.accountId ?? account.appAccountUserId) != null);
    if (!candidates.length) { container.innerHTML = empty("没有可用账号"); return; }
    if (!this.userScope) throw new Error("尚未登录 UniPass");
    const results = await send<CredentialAvailabilityResult[]>({ type: "credentialAvailability", accountIds: candidates.map((account) => (account.id ?? account.accountId ?? account.appAccountUserId) as string | number), userScope: this.userScope });
    const availability = new Map(results.map((result) => [String(result.accountId), result]));
    const available = candidates.filter((account) => { const id = account.id ?? account.accountId ?? account.appAccountUserId; return id != null && availability.get(String(id))?.status === "available"; });
    const failures = results.filter((result) => result.status === "error");
    if (failures.length) this.reportStatus(`有 ${failures.length} 个账号暂时无法验证，已跳过显示`, true);
    if (!available.length) { container.innerHTML = empty(failures.length ? "暂时无法验证账号凭据，请稍后重试" : "没有可用账号"); return; }
    container.replaceChildren();
    for (const account of available) {
      const id = account.id ?? account.accountId ?? account.appAccountUserId; if (id == null) continue;
      const username = account.account || account.phoneNumber || account.email || "未命名账号";
      const root = document.createElement("article"); root.className = "item account-item";
      const main = document.createElement("div"); main.className = "item-main"; main.append(textElement("div", "item-title", username), textElement("div", "item-meta", account.remark || (account.topPriority ? "优先账号" : "无备注")));
      const actions = document.createElement("div"); actions.className = "actions";
      const copy = button("复制账号");
      copy.title = "复制完整账号";
      copy.addEventListener("click", () => void this.copyUsername(username));
      actions.append(copy);
      const fill = button("填入", "primary"); fill.disabled = tabId == null || !appUrl; fill.title = fill.disabled ? "请先打开该应用的 HTTPS 页面" : "填入当前页面"; fill.addEventListener("click", () => void this.fill(tabId, id, appUrl));
      if (this.isAdvancedModeEnabled()) {
        const view = button("查看");
        view.addEventListener("click", () => void this.reveal(id));
        actions.append(view);
      }
      actions.append(fill); root.append(accountIcon(), main, actions); container.append(root);
    }
  }

  private requireUserScope(): string {
    if (!this.userScope) throw new Error("尚未登录 UniPass");
    return this.userScope;
  }

  private async copyUsername(username: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(username);
      this.reportStatus("账号已复制");
    } catch {
      this.reportStatus("浏览器拒绝写入剪贴板", true);
    }
  }

  private async getTabContext(): Promise<PageContext> {
    if (this.getPageContext) return this.getPageContext();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !tab.url) throw new Error("无法识别当前页面");
    return { tabId: tab.id, url: tab.url };
  }

  private showAppList(): void { this.apps.classList.remove("hidden"); this.heading.classList.remove("hidden"); this.back.classList.add("hidden"); this.appAccounts.classList.add("hidden"); this.appAccounts.replaceChildren(); }
}
