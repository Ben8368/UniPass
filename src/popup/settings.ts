import type { PluginVersionSettings } from "../shared/types";
import { send } from "./bridge";
import { errorText, get } from "./dom";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "unipass-theme";

export class SettingsController {
  private readonly themeToggle = get<HTMLButtonElement>("themeToggle");
  private readonly dialog = get("versionSettingsDialog");
  private readonly settingsButton = get<HTMLButtonElement>("pluginVersionSettingsButton");
  private readonly closeButton = get<HTMLButtonElement>("closeVersionSettings");
  private readonly versionForm = get<HTMLFormElement>("versionForm");
  private readonly override = get<HTMLInputElement>("pluginVersionOverride");
  private readonly restoreBaseline = get<HTMLButtonElement>("restorePluginVersionBaseline");
  private readonly localBuildVersion = get("localBuildPluginVersion");
  private readonly networkVersion = get("networkPluginVersion");
  private readonly networkVersionSource = get("networkPluginVersionSource");
  private readonly systemTheme = window.matchMedia("(prefers-color-scheme: light)");

  constructor(private readonly reportStatus: (text: string, isError?: boolean) => void) {}

  bind(): void {
    this.applyStoredTheme();
    this.themeToggle.addEventListener("click", () => this.toggleTheme());
    this.systemTheme.addEventListener("change", () => {
      if (!this.getStoredTheme()) {
        document.documentElement.dataset.theme = this.systemTheme.matches ? "light" : "dark";
        this.updateThemeToggle();
      }
    });
    this.settingsButton.addEventListener("click", () => void this.open());
    this.closeButton.addEventListener("click", () => this.close());
    this.versionForm.addEventListener("submit", (event) => { event.preventDefault(); void this.saveOverride(); });
    this.restoreBaseline.addEventListener("click", () => { this.override.value = ""; void this.saveOverride(); });
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
    window.addEventListener("keydown", (event) => { if (event.key === "Escape" && !this.dialog.classList.contains("hidden")) this.close(); });
  }

  private getStoredTheme(): Theme | null {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  }

  private applyStoredTheme(): void {
    document.documentElement.dataset.theme = this.getStoredTheme() ?? (this.systemTheme.matches ? "light" : "dark");
    this.updateThemeToggle();
  }

  private toggleTheme(): void {
    const theme = this.effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    this.updateThemeToggle();
  }

  private effectiveTheme(): Theme {
    return document.documentElement.dataset.theme === "light" || (document.documentElement.dataset.theme !== "dark" && this.systemTheme.matches) ? "light" : "dark";
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
    this.networkVersion.textContent = "检查中";
    this.networkVersionSource.textContent = "";
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
      ? `手动指定（商店基线 ${settings.storeBaselineVersion}）`
      : "商店基线（构建时同步）";
  }

  private async saveOverride(): Promise<void> {
    try {
      const settings = await send<PluginVersionSettings>({
        type: "setPluginVersionOverride",
        version: this.override.value,
      });
      this.apply(settings);
      this.reportStatus(settings.source === "manual" ? "网络提交版本已手动指定" : "网络提交版本已恢复商店基线");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

}
