import type { AccountCatalogEntry, AccountCatalogResult, AccountListResult, AvailableAppsResult, CredentialAvailabilityResult, CurrentUser, JupiterKeepaliveSettings, PageContext, UniPassAccount, UniPassApp } from "../shared/types";
import type { AccountRef, VaultAccount, VaultApp, VaultConnectionState } from "../shared/vault";
import { appUrlMatches, isHttpsUrl, vaultTargetMatches } from "../shared/url";
import { userScopeFor } from "../shared/user-scope";
import { send } from "./bridge";
import { CurrentPageAccountEditor } from "./current-page-account";
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
  private readonly currentPageEditor: CurrentPageAccountEditor;
  private storageKey: string | null = null;
  private userScope: string | null = null;

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly reveal: (accountId: string | number) => Promise<void>,
    private readonly fill: (tabId: number | undefined, accountId: string | number, appUrl?: string, accountRef?: AccountRef) => Promise<void>,
    private readonly getPageContext?: () => Promise<PageContext>,
    private readonly openApp?: (appId: string | number, userScope: string, vaultId?: string) => Promise<void>,
    private readonly storage: DomStorage = window.localStorage,
    private readonly isAdvancedModeEnabled: () => boolean = () => false,
  ) {
    this.currentPageEditor = new CurrentPageAccountEditor(
      this.currentAccounts,
      reportStatus,
      () => this.refreshCurrentPage(),
      () => window.dispatchEvent(new Event("unipass-open-webdav-settings")),
    );
  }

  bind(): void {
    this.refresh.addEventListener("click", () => void this.refreshCurrentPage());
    window.addEventListener("unipass-vault-changed", () => void this.refreshCurrentPage());
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
      const connectionStates = await send<VaultConnectionState[]>({ type: "listVaultConnectionStates" });
      const connectedVaultIds = new Set(connectionStates.filter((state) => state.connected).map((state) => state.vaultId));
      let catalog = override ?? this.loadCached();
      if (!catalog && !this.userScope) catalog = await this.loadVaultCatalog();
      if (!override && this.userScope && (!catalog || Date.now() - catalog.syncedAt > TTL_MS)) catalog = await this.sync();
      if (!catalog) throw new Error("账号目录不可用，请重新同步");
      const accounts = this.accountsForUrl(catalog.entries, tab.url, connectedVaultIds);
      if (!accounts.length) await this.currentPageEditor.render(tab, catalog.entries, connectionStates);
      else await this.renderAccounts(this.currentAccounts, accounts, tab.tabId, tab.url);
    } catch (error) {
      this.currentAccounts.innerHTML = empty(errorText(error));
    }
  }

  async loadApps(keyword = ""): Promise<void> {
    this.apps.innerHTML = loading("正在加载应用");
    this.showAppList();
    try {
      // The popup can briefly outlive a service-worker update. Accept the pre-filter
      // array response during that window, but reject malformed responses explicitly.
      const result = normalizeAvailableAppsResult(await send<AvailableAppsResult>({ type: "listApps", keyword, userScope: this.requireUserScope() }));
      this.reportAppFiltering(result);
      await this.renderApps(result);
    }
    catch (error) { this.apps.innerHTML = empty(errorText(error)); }
  }

  private async refreshCurrentPage(): Promise<void> {
    try { await this.loadCurrentPage(this.userScope ? await this.sync() : undefined); }
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
      const connectionStates = await send<VaultConnectionState[]>({ type: "listVaultConnectionStates" });
      const disconnectedVaults = new Map(connectionStates.filter((state) => !state.connected).map((state) => [state.vaultId, state.name]));
      const reconnectFailures = result.failures.filter((failure) => failure.vaultId && disconnectedVaults.has(failure.vaultId));
      const otherFailures = result.failures.filter((failure) => !reconnectFailures.includes(failure));
      const notices: string[] = [];
      if (reconnectFailures.length) {
        const names = reconnectFailures.map((failure) => disconnectedVaults.get(failure.vaultId!) ?? "WebDAV 密码库").join("、");
        notices.push(`密码库 ${names} 需要重新连接，账号目录未读取`);
      }
      if (otherFailures.length) notices.push(`有 ${otherFailures.length} 个应用同步失败`);
      notices.push(previous ? "继续使用上次完整目录" : "本次结果不会缓存");
      this.reportStatus(notices.join("；"), true);
      return previous ?? { syncedAt: 0, entries: result.entries };
    } finally { this.refresh.disabled = false; }
  }

  private async loadVaultCatalog(): Promise<CachedCatalog> {
    const result = await send<{ entries: Array<{ app: VaultApp; accounts: VaultAccount[] }>; failures: Array<{ vaultId: string; error: string }> }>({ type: "vaultCatalog" });
    if (result.failures.length) throw new Error(result.failures.map((failure) => failure.error).join("；"));
    return {
      syncedAt: Date.now(),
      entries: result.entries.map(({ app, accounts }) => ({
        appId: app.id,
        appName: app.name,
        appUrl: app.targets[0] ? `https://${app.targets[0].host}${app.targets[0].pathPrefix || "/"}` : "",
        accounts: accounts.map((account) => ({ id: account.id, account: account.username, remark: account.remark, vaultId: account.vaultId, appId: account.appId, accountRef: { vaultId: account.vaultId, accountId: account.id } })),
        vaultId: app.vaultId,
        targets: app.targets,
      })),
    };
  }

  private accountsForUrl(entries: AccountCatalogEntry[], url: string, connectedVaultIds?: Set<string>): UniPassAccount[] {
    const seen = new Set<string>();
    return entries.flatMap((entry) => entry.targets?.length
      ? (entry.targets.some((target) => vaultTargetMatches(target, url)) && (!entry.vaultId || !connectedVaultIds || connectedVaultIds.has(entry.vaultId)) ? entry.accounts : [])
      : (appUrlMatches(entry.appUrl, url) ? entry.accounts : [])).filter((account) => {
      const id = account.id ?? account.accountId ?? account.appAccountUserId;
      const key = id == null ? JSON.stringify(account) : `${account.vaultId ?? "legacy-unipass"}:${String(id)}`;
      if (seen.has(key) || (account.vaultId && connectedVaultIds && !connectedVaultIds.has(account.vaultId))) return false;
      seen.add(key); return true;
    });
  }

  private reportAppFiltering(result: AvailableAppsResult): void {
    const notices: string[] = [];
    if (result.excludedEmptyCredentialApps) notices.push(`${result.excludedEmptyCredentialApps} 个应用没有可用密码，已隐藏`);
    if (result.excludedVerificationFailureApps) notices.push(`${result.excludedVerificationFailureApps} 个应用的凭据暂时无法验证，已隐藏`);
    if (result.excludedDirectoryFailureApps) notices.push(`${result.excludedDirectoryFailureApps} 个应用账号目录同步失败，已隐藏`);
    if (notices.length) {
      const hasFailure = result.excludedVerificationFailureApps > 0 || result.excludedDirectoryFailureApps > 0;
      this.reportStatus(notices.join("；"), hasFailure);
    }
  }

  private async renderApps(result: AvailableAppsResult): Promise<void> {
    const { apps } = result;
    this.apps.replaceChildren();
    if (!apps.length) {
      this.apps.innerHTML = empty(result.totalApps ? "没有可用账号" : "未找到应用");
      return;
    }
    const keepalive = await send<JupiterKeepaliveSettings>({ type: "getJupiterKeepalive", userScope: this.requireUserScope() });
    for (const app of apps) {
      const title = app.name || app.appName || `应用 ${app.id}`;
      const isJupiter = !app.vaultId && /木星|jupiter/i.test(title);
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
      if (this.openApp) await this.openApp(app.id, this.requireUserScope(), app.vaultId);
      else await chrome.tabs.create({ url: await send<string>({ type: "appUrl", appId: app.id, vaultId: app.vaultId, userScope: this.requireUserScope() }) });
      this.reportStatus("已打开应用页面");
    }
    catch (error) { this.reportStatus(errorText(error), true); }
  }

  private async loadAppAccounts(app: UniPassApp): Promise<void> {
    this.apps.classList.add("hidden"); this.heading.classList.add("hidden"); this.back.classList.remove("hidden"); this.appAccounts.classList.remove("hidden"); this.appAccounts.innerHTML = loading("正在加载账号");
    try { const result = await send<AccountListResult>({ type: "accountsForApp", appId: app.id, vaultId: app.vaultId, userScope: this.requireUserScope() }); const tab = await this.getTabContext(); const id = tab?.tabId != null && tab.url && appUrlMatches(result.appUrl, tab.url) ? tab.tabId : undefined; await this.renderAccounts(this.appAccounts, result.accounts, id, result.appUrl); }
    catch (error) { this.appAccounts.innerHTML = empty(errorText(error)); }
  }

  private async renderAccounts(container: HTMLElement, accounts: UniPassAccount[], tabId?: number, appUrl?: string): Promise<void> {
    const candidates = accounts.filter((account) => (account.id ?? account.accountId ?? account.appAccountUserId) != null);
    if (!candidates.length) { container.innerHTML = empty("没有可用账号"); return; }
    const refs = candidates.map((account) => this.accountRefFor(account));
    const vaultOnly = refs.every((ref) => ref.vaultId !== "legacy-unipass");
    if (!this.userScope && !vaultOnly) throw new Error("尚未登录 UniPass");
    const results = await send<CredentialAvailabilityResult[]>({ type: "credentialAvailability", accountIds: candidates.map((account) => (account.id ?? account.accountId ?? account.appAccountUserId) as string | number), accountRefs: refs, userScope: this.userScope ?? "" });
    const availability = new Map(results.map((result) => [`${result.accountRef?.vaultId ?? "legacy-unipass"}:${String(result.accountRef?.accountId ?? result.accountId)}`, result]));
    const available = candidates.filter((account) => { const id = account.id ?? account.accountId ?? account.appAccountUserId; return id != null && availability.get(`${this.accountRefFor(account).vaultId}:${String(id)}`)?.status === "available"; });
    const failures = results.filter((result) => result.status === "error");
    if (failures.length) this.reportStatus(`有 ${failures.length} 个账号暂时无法验证，已跳过显示`, true);
    if (!available.length) { container.innerHTML = empty(failures.length ? "暂时无法验证账号凭据，请稍后重试" : "没有可用账号"); return; }
    container.replaceChildren();
    for (const account of available) {
      const rawId = account.id ?? account.accountId ?? account.appAccountUserId; if (rawId == null) continue;
      const ref = this.accountRefFor(account);
      const id: string | number = ref.vaultId === "legacy-unipass" ? rawId : `${ref.vaultId}:${ref.accountId}`;
      const username = account.account || account.phoneNumber || account.email || "未命名账号";
      const root = document.createElement("article"); root.className = "item account-item";
      const main = document.createElement("div"); main.className = "item-main"; main.append(textElement("div", "item-title", username), textElement("div", "item-meta", account.remark || (account.topPriority ? "优先账号" : "无备注")));
      const actions = document.createElement("div"); actions.className = "actions";
      const copy = button("复制账号");
      copy.title = "复制完整账号";
      copy.addEventListener("click", () => void this.copyUsername(username));
      actions.append(copy);
      const fill = button("填入", "primary"); fill.disabled = tabId == null || !appUrl; fill.title = fill.disabled ? "请先打开该应用的 HTTPS 页面" : "填入当前页面"; fill.addEventListener("click", () => void this.fill(tabId, id, appUrl, ref));
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

  private accountRefFor(account: UniPassAccount): AccountRef {
    const id = account.id ?? account.accountId ?? account.appAccountUserId;
    if (id == null) throw new Error("账号缺少有效 ID");
    return account.accountRef ?? { vaultId: account.vaultId ?? "legacy-unipass", accountId: String(id) };
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

function normalizeAvailableAppsResult(value: unknown): AvailableAppsResult {
  if (Array.isArray(value)) {
    return {
      apps: value as UniPassApp[],
      totalApps: value.length,
      excludedEmptyCredentialApps: 0,
      excludedVerificationFailureApps: 0,
      excludedDirectoryFailureApps: 0,
    };
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as Partial<AvailableAppsResult>).apps)) {
    throw new Error("应用列表返回格式异常，请重新加载扩展");
  }
  const result = value as Partial<AvailableAppsResult>;
  return {
    apps: result.apps as UniPassApp[],
    totalApps: nonNegativeCount(result.totalApps),
    excludedEmptyCredentialApps: nonNegativeCount(result.excludedEmptyCredentialApps),
    excludedVerificationFailureApps: nonNegativeCount(result.excludedVerificationFailureApps),
    excludedDirectoryFailureApps: nonNegativeCount(result.excludedDirectoryFailureApps),
  };
}

function nonNegativeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
