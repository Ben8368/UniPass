import type { DomStorage } from "./dom";
import { get } from "./dom";

export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "unipass-theme";

export class ThemeController {
  private readonly themeToggle = get<HTMLButtonElement>("themeToggle");
  private readonly systemTheme = window.matchMedia("(prefers-color-scheme: light)");

  constructor(
    private readonly storage: DomStorage,
    private readonly themeTarget: HTMLElement,
  ) {}

  bind(): void {
    this.applyStoredTheme();
    this.themeToggle.addEventListener("click", () => this.toggleTheme());
    this.systemTheme.addEventListener("change", () => {
      if (!this.getStoredTheme()) {
        this.themeTarget.dataset.theme = this.systemTheme.matches ? "light" : "dark";
        this.updateThemeToggle();
      }
    });
  }

  applyAutoTheme(theme: Theme): void {
    if (this.getStoredTheme()) return;
    this.themeTarget.dataset.theme = theme;
    this.updateThemeToggle();
  }

  private getStoredTheme(): Theme | null {
    const value = this.storage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  }

  private applyStoredTheme(): void {
    this.themeTarget.dataset.theme = this.getStoredTheme() ?? (this.systemTheme.matches ? "light" : "dark");
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
}
