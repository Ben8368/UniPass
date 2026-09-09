import type { Credential, FillResult } from "../shared/types";
import { send } from "./bridge";
import { errorText, get } from "./dom";

const CREDENTIAL_TTL_SECONDS = 60;

export class CredentialController {
  private readonly panel = get("credentialPanel");
  private readonly username = get<HTMLInputElement>("credentialUsername");
  private readonly password = get<HTMLInputElement>("credentialPassword");
  private readonly countdown = get("credentialCountdown");
  private readonly showPassword = get<HTMLInputElement>("showPassword");
  private current: Credential | null = null;
  private clearTimer: number | undefined;
  private countdownTimer: number | undefined;
  private clearAt = 0;

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly getUserScope: () => string | null,
    private readonly fillFromOverlay = false,
  ) {}

  bind(): void {
    get<HTMLButtonElement>("copyUsername").addEventListener("click", () => void this.copy("username"));
    get<HTMLButtonElement>("copyPassword").addEventListener("click", () => void this.copy("password"));
    this.showPassword.addEventListener("change", () => { this.password.type = this.showPassword.checked ? "text" : "password"; });
    window.addEventListener("pagehide", () => this.clear());
  }

  async reveal(accountId: string | number, fallbackUsername: string): Promise<void> {
    try {
      this.reportStatus("正在获取凭据");
      const userScope = this.getUserScope();
      if (!userScope) throw new Error("尚未登录 UniPass");
      this.show(await send<Credential>({ type: "credential", accountId, fallbackUsername, userScope }));
      this.reportStatus("凭据只保留在当前弹窗内存中");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  async fill(tabId: number | undefined, accountId: string | number, fallbackUsername: string, expectedAppUrl?: string): Promise<void> {
    if (tabId == null || !expectedAppUrl) return;
    if (this.fillFromOverlay) {
      try {
        const userScope = this.getUserScope();
        if (!userScope) throw new Error("尚未登录 UniPass");
        const result = await send<FillResult>({ type: "fillFromOverlay", accountId, fallbackUsername, expectedAppUrl, userScope });
        if (!result?.ok) throw new Error(result?.error || "填充失败");
        this.reportStatus(result.usernameFilled ? "账号和密码已填入，未自动提交" : "密码已填入；未找到账号输入框");
      } catch (error) {
        this.reportStatus(errorText(error), true);
      }
      return;
    }
    try {
      this.reportStatus("正在填入当前页面");
      const userScope = this.getUserScope();
      if (!userScope) throw new Error("尚未登录 UniPass");
      const result = await send<FillResult>({
        type: "fillFromPopup",
        tabId,
        accountId,
        fallbackUsername,
        expectedAppUrl,
        userScope,
      });
      if (!result?.ok) throw new Error(result?.error || "填充失败");
      this.reportStatus(result.usernameFilled ? "账号和密码已填入，未自动提交" : "密码已填入；未找到账号输入框");
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  private show(credential: Credential): void {
    this.clear();
    this.current = credential;
    this.username.value = credential.username;
    this.password.value = credential.password;
    this.password.type = "password";
    this.showPassword.checked = false;
    this.panel.classList.remove("hidden");
    this.clearAt = Date.now() + CREDENTIAL_TTL_SECONDS * 1000;
    this.updateCountdown();
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 1000);
    this.clearTimer = window.setTimeout(() => this.clear(), CREDENTIAL_TTL_SECONDS * 1000);
  }

  private clear(): void {
    if (this.current) this.current.password = "";
    this.current = null;
    this.username.value = "";
    this.password.value = "";
    this.password.type = "password";
    this.showPassword.checked = false;
    this.panel.classList.add("hidden");
    if (this.clearTimer) window.clearTimeout(this.clearTimer);
    if (this.countdownTimer) window.clearInterval(this.countdownTimer);
    this.clearTimer = undefined;
    this.countdownTimer = undefined;
  }

  private updateCountdown(): void {
    this.countdown.textContent = `${Math.max(0, Math.ceil((this.clearAt - Date.now()) / 1000))} 秒后清除`;
  }

  private async copy(field: keyof Credential): Promise<void> {
    const value = this.current?.[field];
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.reportStatus(field === "password" ? "密码已复制" : "账号已复制");
    } catch {
      this.reportStatus("浏览器拒绝写入剪贴板", true);
    }
  }
}
