import type { PluginVersionSettings } from "../shared/types";
import { AdvancedModeUnlock } from "./advanced-mode";
import { SELF_BUILD_CLICK_WINDOW_MS } from "./self-builder";
import { SaveGestureStateMachine } from "./save-gesture";
import { SelfBuildDialogController } from "./self-build-dialog";
import { send } from "./bridge";
import { errorText, get } from "./dom";
import type { DomStorage } from "./dom";
import { ThemeController, type Theme } from "./theme-controller";
import { WebDavSettingsController } from "./webdav-settings";
import { authenticateSystemAuthenticator, registerSystemAuthenticator } from "./system-auth";
import { BrowserPasswordImportController } from "./import-passwords";

const ADVANCED_MODE_PORT_NAME = "unipass-advanced-mode";

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
  private readonly dialog = get("versionSettingsDialog");
  private readonly settingsButton = get<HTMLButtonElement>("pluginVersionSettingsButton");
  private readonly closeButton = get<HTMLButtonElement>("closeVersionSettings");
  private readonly versionForm = get<HTMLFormElement>("versionForm");
  private readonly override = get<HTMLInputElement>("pluginVersionOverride");
  private readonly saveButton = get<HTMLButtonElement>("versionSave");
  private readonly restoreBaseline = get<HTMLButtonElement>("restorePluginVersionBaseline");
  private readonly localBuildVersion = get("localBuildPluginVersion");
  private readonly localBuildTime = get("localBuildTime");
  private readonly networkVersion = get("networkPluginVersion");
  private readonly networkVersionSource = get("networkPluginVersionSource");
  private saveControlsDisabled = false;
  private advancedModeActive = false;
  private advancedModePending = false;
  private advancedPort: chrome.runtime.Port | null = null;
  private disposed = false;
  private readonly webdavSettings: WebDavSettingsController;
  private readonly selfBuild: SelfBuildDialogController;
  private readonly theme: ThemeController;
  private readonly advancedModeUnlock = new AdvancedModeUnlock(SELF_BUILD_CLICK_WINDOW_MS);
  private readonly browserImport: BrowserPasswordImportController;
  private readonly saveGesture = new SaveGestureStateMachine(
    () => void this.saveOverride(),
    () => this.selfBuild.open(this.override.value.trim()),
    SELF_BUILD_CLICK_WINDOW_MS,
    (callback, delay) => window.setTimeout(callback, delay),
    (timer) => window.clearTimeout(timer),
  );

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly storage: DomStorage = window.localStorage,
    private readonly themeTarget: HTMLElement = document.documentElement,
    private readonly onAdvancedModeChange: () => void = () => {},
  ) {
    this.webdavSettings = new WebDavSettingsController(reportStatus, () => void this.enterAdvancedMode(undefined, true), () => void this.setupSystemAuthenticator());
    this.browserImport = new BrowserPasswordImportController(reportStatus);
    this.selfBuild = new SelfBuildDialogController(reportStatus, (disabled) => this.setSaveControlsDisabled(disabled));
    this.theme = new ThemeController(storage, themeTarget);
  }

  get isAdvancedModeEnabled(): boolean {
    return this.advancedModeActive;
  }

  bind(): void {
    this.theme.bind();
    this.settingsButton.addEventListener("click", () => void this.open());
    this.closeButton.addEventListener("click", () => this.close());
    this.versionForm.addEventListener("submit", (event) => { event.preventDefault(); this.resetSaveClicks(); void this.saveOverride(); });
    this.saveButton.addEventListener("click", (event) => { event.preventDefault(); this.handleSaveClick(); });
    this.webdavSettings.bind();
    this.browserImport.bind();
    this.selfBuild.bind();
    window.addEventListener("unipass-open-webdav-settings", (event) => {
      const vaultId = event instanceof CustomEvent && typeof event.detail?.vaultId === "string" ? event.detail.vaultId : undefined;
      void this.open(vaultId);
    });
    this.override.addEventListener("input", () => this.updateRestoreButton());
    this.restoreBaseline.addEventListener("click", () => {
      if (this.advancedModeUnlock.isUnlockReady) {
        void this.enterAdvancedMode();
        return;
      }
      this.advancedModeUnlock.markRestoreDefault();
      this.resetSaveClicks();
      this.override.value = "";
      this.updateRestoreButton();
      void this.saveOverride(true);
    });
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
    window.addEventListener("pagehide", () => {
      this.dispose();
      if (!this.selfBuild.isOpen && !this.selfBuild.isBusy) this.saveGesture.flushPendingSave();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.selfBuild.isOpen) this.selfBuild.close();
      else if (!this.dialog.classList.contains("hidden")) this.close();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.webdavSettings.clearSensitiveState();
    this.browserImport.dispose();
    this.advancedPort?.disconnect();
    this.advancedPort = null;
    this.advancedModeActive = false;
    this.advancedModePending = false;
    this.advancedModeUnlock.reset();
  }

  applyAutoTheme(theme: Theme): void {
    this.theme.applyAutoTheme(theme);
  }

  private async open(vaultId?: string): Promise<void> {
    this.localBuildVersion.textContent = "检查中";
    const manifest = chrome.runtime.getManifest();
    this.localBuildTime.textContent = manifest.version_name || "无构建描述";
    this.networkVersion.textContent = "检查中";
    this.networkVersionSource.textContent = "";
    await this.webdavSettings.open(vaultId);
    if (this.disposed) return;
    this.dialog.classList.remove("hidden");
    this.settingsButton.setAttribute("aria-expanded", "true");
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
    this.webdavSettings.clearSensitiveState();
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
    if (this.selfBuild.isBusy) return;
    if (!keepControlsEnabled) this.setSaveControlsDisabled(true);
    try {
      const settings = await send<PluginVersionSettings>({
        type: "setPluginVersionOverride",
        version: this.override.value,
      });
      this.apply(settings);
      this.reportStatus("版本设置已保存");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    } finally {
      if (!keepControlsEnabled) this.setSaveControlsDisabled(false);
    }
  }

  private handleSaveClick(): void {
    if (this.selfBuild.isBusy || this.selfBuild.isOpen) return;
    if (this.advancedModeUnlock.recordSaveClick()) {
      this.resetSaveClicks();
      this.updateRestoreButton();
      this.reportStatus("高级模式已解锁，点击“解锁高级模式”进入");
      return;
    }
    this.saveGesture.click();
  }

  private async enterAdvancedMode(pin = this.webdavSettings.readGlobalPin(), direct = false): Promise<void> {
    if (this.disposed || this.advancedModePending || (!direct && !this.advancedModeUnlock.enter())) return;
    this.advancedModePending = true;
    this.updateRestoreButton();
    try {
      const auth = await this.advancedUnlockMaterial(pin);
      const token = await send<string>({ type: "enableAdvancedMode", ...auth });
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
      this.webdavSettings.clearGlobalPin();
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

  private async setupSystemAuthenticator(): Promise<void> {
    try {
      await registerSystemAuthenticator(this.webdavSettings.readGlobalPin());
      this.webdavSettings.clearGlobalPin();
      this.reportStatus("系统验证已设置；查看账号密码时将调用 macOS/Windows 的系统认证");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  private async advancedUnlockMaterial(pin: string): Promise<{ systemAuth?: Awaited<ReturnType<typeof authenticateSystemAuthenticator>>; pin?: string }> {
    let configured = false;
    try {
      configured = await send<{ configured: boolean }>({ type: "getSystemAuthenticatorStatus" }).then((result) => result.configured);
    } catch {
      configured = false;
    }
    if (configured) {
      try {
        return { systemAuth: await authenticateSystemAuthenticator() };
      } catch (error) {
        if (!pin) throw new Error("系统验证未完成；可重试，或输入备用 PIN");
        this.reportStatus(`系统验证未完成，将使用备用 PIN：${errorText(error)}`);
      }
    }
    if (!pin) throw new Error("请先设置系统验证，或输入备用 4 至 32 位 PIN");
    return { pin };
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

  private setSaveControlsDisabled(disabled: boolean): void {
    this.saveControlsDisabled = disabled;
    this.saveButton.disabled = disabled;
    this.webdavSettings.setDisabled(disabled);
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
    this.restoreBaseline.textContent = unlockReady ? "解锁高级模式" : "恢复默认";
    this.restoreBaseline.disabled = this.saveControlsDisabled || (!unlockReady && !this.override.value.trim());
  }

}
