import type { VaultConnection, VaultProfile } from "../shared/vault";
import { normalizeWebDavUrl } from "../shared/url";
import { send } from "./bridge";
import { errorText, get } from "./dom";

export class WebDavSettingsController {
  private readonly form = get<HTMLFormElement>("webdavForm");
  private readonly profile = get<HTMLSelectElement>("webdavVaultProfile");
  private readonly fields = get("webdavConnectionFields");
  private readonly actions = get("webdavActions");
  private readonly name = get<HTMLInputElement>("webdavVaultName");
  private readonly endpoint = get<HTMLInputElement>("webdavUrl");
  private readonly username = get<HTMLInputElement>("webdavUsername");
  private readonly appPassword = get<HTMLInputElement>("webdavPassword");
  private readonly vaultKeyField = get("webdavVaultKeyField");
  private readonly vaultKey = get<HTMLInputElement>("webdavVaultKey");
  private readonly test = get<HTMLButtonElement>("testWebDav");
  private readonly save = get<HTMLButtonElement>("saveWebDav");
  private readonly status = get<HTMLParagraphElement>("webdavStatus");
  private readonly recovery = get("webdavRecoveryKey");
  private readonly recoveryKey = get<HTMLInputElement>("webdavRecoveryKeyValue");
  private profiles: VaultProfile[] = [];
  private busy = false;
  private operation: "test" | "save" | null = null;

  constructor(private readonly reportStatus: (text: string, isError?: boolean) => void) {}

  bind(): void {
    this.form.addEventListener("submit", (event) => { event.preventDefault(); void this.saveVault(); });
    this.test.addEventListener("click", () => void this.testConnection());
    this.profile.addEventListener("change", () => this.applySelectedProfile());
  }

  async open(): Promise<void> {
    try {
      this.showStatus("");
      this.profiles = await send<VaultProfile[]>({ type: "listVaultProfiles" });
      this.profile.replaceChildren(new Option("新建密码库", ""), ...this.profiles.map((profile) => new Option(profile.name, profile.id)));
      this.profile.value = this.profiles[0]?.id ?? "";
      this.applySelectedProfile();
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  setDisabled(disabled: boolean): void {
    this.busy = disabled;
    for (const control of [this.profile, this.name, this.endpoint, this.username, this.appPassword, this.vaultKey, this.test, this.save]) control.disabled = disabled;
  }

  clearSensitiveState(): void {
    this.appPassword.value = "";
    this.vaultKey.value = "";
    this.recoveryKey.value = "";
    this.recovery.hidden = true;
  }

  private applySelectedProfile(): void {
    const selected = this.profiles.find((profile) => profile.id === this.profile.value);
    const reconnecting = Boolean(selected);
    this.fields.hidden = false;
    this.actions.hidden = false;
    this.vaultKeyField.hidden = !reconnecting;
    this.recoveryKey.value = "";
    this.recovery.hidden = true;
    this.name.value = selected?.name ?? "";
    this.endpoint.value = selected?.endpoint ?? "";
    this.username.value = "";
    this.appPassword.value = "";
    this.vaultKey.value = "";
    this.save.textContent = reconnecting ? "重新连接" : "保存并连接";
    this.showStatus("");
  }

  private input() {
    return {
      vaultId: this.profile.value || undefined,
      name: this.name.value.trim(),
      endpoint: normalizeWebDavUrl(this.endpoint.value),
      username: this.username.value.trim(),
      appPassword: this.appPassword.value,
      vaultKey: this.vaultKey.value.trim() || undefined,
    };
  }

  private async requestOrigin(endpoint: string): Promise<void> {
    const granted = await send<boolean>({ type: "requestWebDavPermission", endpoint });
    if (!granted) throw new Error("未授予 WebDAV 主机权限，已取消操作");
  }

  private async testConnection(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true, "test");
    this.showStatus("正在测试 WebDAV 连接…");
    try {
      const input = this.input();
      await this.requestOrigin(input.endpoint);
      await send<void>({ type: "testWebDavConnection", ...input });
      this.showStatus("WebDAV 连接和目录权限检查通过");
    } catch (error) {
      this.showStatus(errorText(error), true);
    } finally {
      this.setBusy(false);
    }
  }

  private async saveVault(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true, "save");
    this.showStatus(this.profile.value ? "正在重新连接 WebDAV 密码库…" : "正在保存并连接 WebDAV 密码库…");
    let saved = false;
    try {
      const input = this.input();
      await this.requestOrigin(input.endpoint);
      const connection = await send<VaultConnection>({ type: "saveWebDavVault", ...input });
      saved = true;
      await this.open();
      this.profile.value = connection.profile.id;
      this.applySelectedProfile();
      window.dispatchEvent(new Event("unipass-vault-connected"));
      if (connection.recoveryKey) this.showRecoveryKey(connection.recoveryKey);
      this.showStatus(connection.recoveryKey ? "WebDAV 密码库已保存并连接。请保存下方 Vault Key" : "WebDAV 密码库已重新连接");
    } catch (error) {
      this.showStatus(errorText(error), true);
    } finally {
      if (saved) { this.appPassword.value = ""; this.vaultKey.value = ""; }
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean, operation: "test" | "save" | null = null): void {
    this.busy = busy;
    this.operation = busy ? operation : null;
    for (const control of [this.profile, this.name, this.endpoint, this.username, this.appPassword, this.vaultKey, this.test, this.save]) control.disabled = busy;
    this.test.textContent = this.operation === "test" ? "测试中…" : "测试连接";
    this.save.textContent = this.operation === "save" ? "保存中…" : (this.profile.value ? "重新连接" : "保存并连接");
  }

  private showStatus(text: string, isError = false): void {
    this.status.hidden = !text;
    this.status.textContent = text;
    this.status.classList.toggle("error", isError);
    if (text) this.reportStatus(text, isError);
  }

  private showRecoveryKey(value: string): void {
    this.recoveryKey.value = value;
    this.recovery.hidden = false;
  }
}
