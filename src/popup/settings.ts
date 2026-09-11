import type { PluginVersionSettings } from "../shared/types";
import { AdvancedModeUnlock } from "./advanced-mode";
import { buildSelfDerivedBuild, SELF_BUILD_CLICK_WINDOW_MS, validateSelfBuildTarget } from "./self-builder";
import { SaveGestureStateMachine } from "./save-gesture";
import { send } from "./bridge";
import { errorText, get } from "./dom";
import type { DomStorage } from "./dom";

const ADVANCED_MODE_PORT_NAME = "unipass-advanced-mode";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "unipass-theme";
const WEBDAV_URL_STORAGE_KEY = "unipass-webdav-url";

export function normalizeWebDavUrl(value: string): string {
  const requestedUrl = value.trim();
  if (!requestedUrl) return "";
  let url: URL;
  try {
    url = new URL(requestedUrl);
  } catch {
    throw new Error("WebDAV 地址格式无效");
  }
  if (url.protocol !== "https:") throw new Error("为保护凭据安全，WebDAV 仅支持 HTTPS 地址");
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("WebDAV 地址只能包含 HTTPS 主机和路径");
  }
  return url.toString();
}

export class SettingsController {
  private readonly themeToggle = get<HTMLButtonElement>("themeToggle");
  private readonly dialog = get("versionSettingsDialog");
  private readonly settingsButton = get<HTMLButtonElement>("pluginVersionSettingsButton");
  private readonly closeButton = get<HTMLButtonElement>("closeVersionSettings");
  private readonly versionForm = get<HTMLFormElement>("versionForm");
  private readonly webdavUrl = get<HTMLInputElement>("webdavUrl");
  private readonly override = get<HTMLInputElement>("pluginVersionOverride");
  private readonly saveButton = get<HTMLButtonElement>("versionSave");
  private readonly openVaultManager = get<HTMLButtonElement>("openVaultManager");
  private readonly restoreBaseline = get<HTMLButtonElement>("restorePluginVersionBaseline");
  private readonly localBuildVersion = get("localBuildPluginVersion");
  private readonly localBuildTime = get("localBuildTime");
  private readonly networkVersion = get("networkPluginVersion");
  private readonly networkVersionSource = get("networkPluginVersionSource");
  private readonly selfBuildDialog = get("selfBuildDialog");
  private readonly closeSelfBuildButton = get<HTMLButtonElement>("closeSelfBuild");
  private readonly cancelSelfBuildButton = get<HTMLButtonElement>("cancelSelfBuild");
  private readonly generateSelfBuildButton = get<HTMLButtonElement>("generateSelfBuild");
  private readonly selfBuildCurrentVersion = get("selfBuildCurrentVersion");
  private readonly selfBuildTargetVersion = get("selfBuildTargetVersion");
  private readonly selfBuildTargetNetworkVersion = get("selfBuildTargetNetworkVersion");
  private readonly selfBuildMessage = get("selfBuildMessage");
  private readonly systemTheme = window.matchMedia("(prefers-color-scheme: light)");
  private selfBuildPromptOpen = false;
  private selfBuildBusy = false;
  private saveControlsDisabled = false;
  private advancedModeActive = false;
  private advancedModePending = false;
  private advancedPort: chrome.runtime.Port | null = null;
  private disposed = false;
  private readonly advancedModeUnlock = new AdvancedModeUnlock(SELF_BUILD_CLICK_WINDOW_MS);
  private readonly saveGesture = new SaveGestureStateMachine(
    () => void this.saveOverride(),
    () => this.openSelfBuildPrompt(),
    SELF_BUILD_CLICK_WINDOW_MS,
    (callback, delay) => window.setTimeout(callback, delay),
    (timer) => window.clearTimeout(timer),
  );

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly storage: DomStorage = window.localStorage,
    private readonly themeTarget: HTMLElement = document.documentElement,
    private readonly onAdvancedModeChange: () => void = () => {},
  ) {}

  get isAdvancedModeEnabled(): boolean {
    return this.advancedModeActive;
  }

  bind(): void {
    this.applyStoredTheme();
    this.themeToggle.addEventListener("click", () => this.toggleTheme());
    this.systemTheme.addEventListener("change", () => {
      if (!this.getStoredTheme()) {
        this.themeTarget.dataset.theme = this.systemTheme.matches ? "light" : "dark";
        this.updateThemeToggle();
      }
    });
    this.settingsButton.addEventListener("click", () => void this.open());
    this.closeButton.addEventListener("click", () => this.close());
    this.versionForm.addEventListener("submit", (event) => { event.preventDefault(); this.resetSaveClicks(); void this.saveOverride(); });
    this.saveButton.addEventListener("click", (event) => { event.preventDefault(); this.handleSaveClick(); });
    this.openVaultManager.addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") }));
    this.webdavUrl.addEventListener("input", () => this.updateRestoreButton());
    this.override.addEventListener("input", () => this.updateRestoreButton());
    this.restoreBaseline.addEventListener("click", () => {
      if (this.advancedModeUnlock.isUnlockReady) {
        void this.enterAdvancedMode();
        return;
      }
      this.advancedModeUnlock.markRestoreDefault();
      this.resetSaveClicks();
      this.webdavUrl.value = "";
      this.override.value = "";
      this.updateRestoreButton();
      void this.saveOverride(true);
    });
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
    this.closeSelfBuildButton.addEventListener("click", () => this.closeSelfBuildPrompt());
    this.cancelSelfBuildButton.addEventListener("click", () => this.closeSelfBuildPrompt());
    this.selfBuildDialog.addEventListener("click", (event) => { if (event.target === this.selfBuildDialog) this.closeSelfBuildPrompt(); });
    this.generateSelfBuildButton.addEventListener("click", () => void this.generateSelfBuild());
    window.addEventListener("pagehide", () => {
      this.dispose();
      if (!this.selfBuildPromptOpen && !this.selfBuildBusy) this.saveGesture.flushPendingSave();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!this.selfBuildDialog.classList.contains("hidden")) this.closeSelfBuildPrompt();
      else if (!this.dialog.classList.contains("hidden")) this.close();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.advancedPort?.disconnect();
    this.advancedPort = null;
    this.advancedModeActive = false;
    this.advancedModePending = false;
    this.advancedModeUnlock.reset();
  }

  private getStoredTheme(): Theme | null {
    const value = this.storage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  }

  private applyStoredTheme(): void {
    this.themeTarget.dataset.theme = this.getStoredTheme() ?? (this.systemTheme.matches ? "light" : "dark");
    this.updateThemeToggle();
  }

  applyAutoTheme(theme: Theme): void {
    if (this.getStoredTheme()) return;
    this.themeTarget.dataset.theme = theme;
    this.updateThemeToggle();
  }

  private toggleTheme(): void {
    const theme = this.effectiveTheme() === "dark" ? "light" : "dark";
    this.themeTarget.dataset.theme = theme;
    this.storage.setItem(THEME_STORAGE_KEY, theme);
    this.updateThemeToggle();
  }

  private effectiveTheme(): Theme {
    return this.themeTarget.dataset.theme === "light" || (this.themeTarget.dataset.theme !== "dark" && this.systemTheme.matches) ? "light" : "dark";
  }

  private updateThemeToggle(): void {
    const dark = this.effectiveTheme() === "dark";
    const label = dark ? "切换浅色模式" : "切换深色模式";
    this.themeToggle.title = label;
    this.themeToggle.setAttribute("aria-label", label);
    this.themeToggle.dataset.theme = dark ? "dark" : "light";
  }

  private async open(): Promise<void> {
    this.dialog.classList.remove("hidden");
    this.settingsButton.setAttribute("aria-expanded", "true");
    this.localBuildVersion.textContent = "检查中";
    const manifest = chrome.runtime.getManifest();
    this.localBuildTime.textContent = manifest.version_name || "无构建描述";
    this.networkVersion.textContent = "检查中";
    this.networkVersionSource.textContent = "";
    this.webdavUrl.value = this.readStoredWebDavUrl();
    this.closeButton.focus();
    try {
      this.apply(await send<PluginVersionSettings>({ type: "getPluginVersionSettings" }));
    } catch (error) {
      this.localBuildVersion.textContent = "无法读取";
      this.networkVersion.textContent = "无法读取";
      this.networkVersionSource.textContent = "";
      this.reportStatus(errorText(error), true);
    }
  }

  private close(): void {
    this.dialog.classList.add("hidden");
    this.settingsButton.setAttribute("aria-expanded", "false");
    this.settingsButton.focus();
  }

  private apply(settings: PluginVersionSettings): void {
    this.override.value = settings.override;
    this.localBuildVersion.textContent = settings.localBuildVersion;
    this.networkVersion.textContent = settings.networkVersion;
    this.networkVersionSource.textContent = settings.source === "manual"
      ? `手动指定（内置基线 ${settings.storeBaselineVersion}）`
      : "构建内置网络基线（构建时生成）";
    this.updateRestoreButton();
  }

  private async saveOverride(keepControlsEnabled = false): Promise<void> {
    if (this.selfBuildBusy) return;
    if (!keepControlsEnabled) this.setSaveControlsDisabled(true);
    try {
      const webdavUrl = normalizeWebDavUrl(this.webdavUrl.value);
      const settings = await send<PluginVersionSettings>({
        type: "setPluginVersionOverride",
        version: this.override.value,
      });
      if (webdavUrl) this.storage.setItem(WEBDAV_URL_STORAGE_KEY, webdavUrl);
      else this.storage.removeItem(WEBDAV_URL_STORAGE_KEY);
      this.webdavUrl.value = webdavUrl;
      this.apply(settings);
      this.reportStatus(webdavUrl ? "WebDAV 地址已保存" : "WebDAV 地址已清除");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    } finally {
      if (!keepControlsEnabled) this.setSaveControlsDisabled(false);
    }
  }

  private handleSaveClick(): void {
    if (this.selfBuildBusy || this.selfBuildPromptOpen) return;
    if (this.advancedModeUnlock.recordSaveClick()) {
      this.resetSaveClicks();
      this.updateRestoreButton();
      this.reportStatus("高级模式已解锁，点击“解锁高级模式”进入");
      return;
    }
    this.saveGesture.click();
  }

  private async enterAdvancedMode(): Promise<void> {
    if (this.disposed || this.advancedModePending || !this.advancedModeUnlock.enter()) return;
    this.advancedModePending = true;
    this.updateRestoreButton();
    try {
      const token = await send<string>({ type: "enableAdvancedMode" });
      const port = await this.connectAdvancedMode(token);
      if (this.disposed) {
        port.disconnect();
        return;
      }
      this.advancedPort = port;
      this.advancedModeActive = true;
      port.onDisconnect.addListener(() => {
        if (this.advancedPort !== port) return;
        this.advancedPort = null;
        this.advancedModeActive = false;
        this.advancedModeUnlock.reset();
        this.updateRestoreButton();
        this.onAdvancedModeChange();
      });
      this.updateRestoreButton();
      this.onAdvancedModeChange();
      this.reportStatus("高级模式已开启，可查看和复制密码");
    } catch (error) {
      this.advancedModeUnlock.reset();
      this.updateRestoreButton();
      this.reportStatus(errorText(error), true);
    } finally {
      this.advancedModePending = false;
      this.updateRestoreButton();
    }
  }

  private connectAdvancedMode(token: string): Promise<chrome.runtime.Port> {
    const port = chrome.runtime.connect({ name: ADVANCED_MODE_PORT_NAME });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (error) {
          port.disconnect();
          reject(error);
        } else {
          resolve(port);
        }
      };
      port.onMessage.addListener((message: { type?: string }) => {
        if (message?.type === "advancedModeEnabled") finish();
      });
      port.onDisconnect.addListener(() => finish(new Error("高级模式未能启用")));
      port.postMessage({ type: "advancedModeHandshake", token });
    });
  }

  private resetSaveClicks(): void {
    this.saveGesture.reset();
  }

  private openSelfBuildPrompt(): void {
    try {
      const current = chrome.runtime.getManifest().version;
      const target = this.override.value.trim();
      const network = validateSelfBuildTarget(target, current);
      this.selfBuildCurrentVersion.textContent = current;
      this.selfBuildTargetVersion.textContent = target;
      this.selfBuildTargetNetworkVersion.textContent = network;
      this.selfBuildMessage.textContent = "将复制当前 runtime 文件并生成 ZIP；不会修改当前扩展。";
      this.generateSelfBuildButton.hidden = false;
      this.cancelSelfBuildButton.textContent = "取消";
      this.selfBuildPromptOpen = true;
      this.selfBuildDialog.classList.remove("hidden");
      this.generateSelfBuildButton.focus();
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  private closeSelfBuildPrompt(): void {
    if (this.selfBuildBusy) return;
    this.selfBuildPromptOpen = false;
    this.selfBuildDialog.classList.add("hidden");
    this.generateSelfBuildButton.hidden = false;
    this.cancelSelfBuildButton.textContent = "取消";
    this.selfBuildMessage.textContent = "";
    this.saveButton.focus();
  }

  private async generateSelfBuild(): Promise<void> {
    if (!this.selfBuildPromptOpen || this.selfBuildBusy) return;
    this.selfBuildBusy = true;
    this.setSaveControlsDisabled(true);
    this.generateSelfBuildButton.disabled = true;
    this.cancelSelfBuildButton.disabled = true;
    this.closeSelfBuildButton.disabled = true;
    this.selfBuildMessage.textContent = "正在读取当前 runtime 文件并生成 ZIP…";
    try {
      const result = await buildSelfDerivedBuild(this.selfBuildTargetVersion.textContent ?? "");
      this.selfBuildMessage.textContent = `已生成 ${result.fileName}\nLocal Build Version: ${result.targetLocalVersion}\nX-Browser-Plugin-Version: ${result.targetNetworkVersion}\n\n解压后覆盖/替换当前扩展目录，然后在 chrome://extensions 中重新加载。`;
      this.generateSelfBuildButton.hidden = true;
      this.cancelSelfBuildButton.disabled = false;
      this.cancelSelfBuildButton.textContent = "关闭";
      this.reportStatus(`已生成 UniPass ${result.targetLocalVersion}`);
    } catch (error) {
      this.selfBuildMessage.textContent = errorText(error);
      this.reportStatus(errorText(error), true);
      this.cancelSelfBuildButton.disabled = false;
      this.cancelSelfBuildButton.textContent = "关闭";
    } finally {
      this.selfBuildBusy = false;
      this.setSaveControlsDisabled(false);
      this.closeSelfBuildButton.disabled = false;
    }
  }

  private setSaveControlsDisabled(disabled: boolean): void {
    this.saveControlsDisabled = disabled;
    this.saveButton.disabled = disabled;
    this.openVaultManager.disabled = disabled;
    this.webdavUrl.disabled = disabled;
    this.override.disabled = disabled;
    this.updateRestoreButton();
  }

  private updateRestoreButton(): void {
    if (this.advancedModeUnlock.isEntered) {
      if (this.advancedModePending) {
        this.restoreBaseline.textContent = "正在开启高级模式";
        this.restoreBaseline.disabled = true;
        return;
      }
      this.restoreBaseline.textContent = "高级模式已开启";
      this.restoreBaseline.disabled = true;
      return;
    }
    const unlockReady = this.advancedModeUnlock.isUnlockReady;
    this.restoreBaseline.textContent = unlockReady ? "解锁高级模式" : "确定";
    this.restoreBaseline.disabled = this.saveControlsDisabled || (!unlockReady && !this.override.value.trim() && !this.webdavUrl.value.trim());
  }

  private readStoredWebDavUrl(): string {
    const value = this.storage.getItem(WEBDAV_URL_STORAGE_KEY);
    if (!value) return "";
    try {
      return normalizeWebDavUrl(value);
    } catch {
      return "";
    }
  }

}
