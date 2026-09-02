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
  private readonly form = get<HTMLFormElement>("versionForm");
  private readonly override = get<HTMLInputElement>("pluginVersionOverride");
  private readonly effectiveVersion = get("effectivePluginVersion");
  private readonly source = get("pluginVersionSource");
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
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
    this.form.addEventListener("submit", (event) => { event.preventDefault(); void this.save(); });
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
    this.override.value = "";
    this.effectiveVersion.textContent = "检查中";
    this.source.textContent = "";
    this.override.focus();
    try {
      this.apply(await send<PluginVersionSettings>({ type: "getPluginVersionSettings" }));
    } catch (error) {
      this.effectiveVersion.textContent = "5.3.0";
      this.source.textContent = "暂时无法获取，使用回退版本";
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
    this.effectiveVersion.textContent = settings.effective;
    this.source.textContent = settings.source === "manual" ? "手动指定" : settings.source === "store" ? "自动获取" : "网络不可用，回退版本";
  }

  private async save(): Promise<void> {
    const submit = this.form.querySelector<HTMLButtonElement>("button[type=submit]");
    if (submit) submit.disabled = true;
    try {
      this.apply(await send<PluginVersionSettings>({ type: "setPluginVersionOverride", version: this.override.value }));
      this.reportStatus("版本设置已保存");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }
}
