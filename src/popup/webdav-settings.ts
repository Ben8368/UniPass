import type { VaultConnection, VaultProfile } from "../shared/vault";
import { normalizeWebDavUrl } from "../shared/url";
import { send } from "./bridge";
import { errorText, get } from "./dom";

const CREATE_PROFILE_VALUE = "__create__";
const EXISTING_PROFILE_VALUE = "__existing__";

export class WebDavSettingsController {
  private readonly form = get<HTMLFormElement>("webdavForm");
  private readonly profile = get<HTMLSelectElement>("webdavVaultProfile");
  private readonly fields = get("webdavConnectionFields");
  private readonly taskHint = get("webdavTaskHint");
  private readonly actions = get("webdavActions");
  private readonly nameField = get("webdavVaultNameField");
  private readonly name = get<HTMLInputElement>("webdavVaultName");
  private readonly endpoint = get<HTMLInputElement>("webdavUrl");
  private readonly username = get<HTMLInputElement>("webdavUsername");
  private readonly appPassword = get<HTMLInputElement>("webdavPassword");
  private readonly vaultKeyField = get("webdavVaultKeyField");
  private readonly vaultKey = get<HTMLInputElement>("webdavVaultKey");
  private readonly remove = get<HTMLButtonElement>("removeWebDavVault");
  private readonly test = get<HTMLButtonElement>("testWebDav");
  private readonly save = get<HTMLButtonElement>("saveWebDav");
  private readonly status = get<HTMLParagraphElement>("webdavStatus");
  private readonly recovery = get("webdavRecoveryKey");
  private readonly recoveryKey = get<HTMLInputElement>("webdavRecoveryKeyValue");
  private readonly localUnlock = get<HTMLDetailsElement>("webdavLocalUnlock");
  private readonly localUnlockPassword = get<HTMLInputElement>("webdavLocalUnlockPassword");
  private readonly enableLocalUnlock = get<HTMLButtonElement>("enableWebDavLocalUnlock");
  private readonly unlockLocalUnlock = get<HTMLButtonElement>("unlockWebDavLocalUnlock");
  private readonly lock = get<HTMLButtonElement>("lockWebDavVault");
  private readonly disableLocalUnlock = get<HTMLButtonElement>("disableWebDavLocalUnlock");
  private profiles: VaultProfile[] = [];
  private busy = false;
  private operation: "test" | "save" | "remove" | null = null;

  constructor(private readonly reportStatus: (text: string, isError?: boolean) => void) {}

  bind(): void {
    this.form.addEventListener("submit", (event) => { event.preventDefault(); void this.saveVault(); });
    this.remove.addEventListener("click", () => void this.removeVault());
    this.test.addEventListener("click", () => void this.testConnection());
    this.profile.addEventListener("change", () => this.applySelectedProfile());
    this.enableLocalUnlock.addEventListener("click", () => void this.localUnlockAction("enable"));
    this.unlockLocalUnlock.addEventListener("click", () => void this.localUnlockAction("unlock"));
    this.lock.addEventListener("click", () => void this.localUnlockAction("lock"));
    this.disableLocalUnlock.addEventListener("click", () => void this.localUnlockAction("disable"));
  }

  async open(vaultId?: string): Promise<void> {
    try {
      this.showStatus("");
      this.profiles = await send<VaultProfile[]>({ type: "listVaultProfiles" });
      this.profile.replaceChildren(
        new Option("新建密码库", CREATE_PROFILE_VALUE),
        new Option("连接已有密码库", EXISTING_PROFILE_VALUE),
        ...this.profiles.map((profile) => new Option(`本地 · ${profile.name}`, profile.id)),
      );
      const selectedVaultId = vaultId && this.profiles.some((profile) => profile.id === vaultId) ? vaultId : "";
      this.profile.value = selectedVaultId || CREATE_PROFILE_VALUE;
      this.applySelectedProfile();
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  setDisabled(disabled: boolean): void {
    this.busy = disabled;
    this.updateDisabledStates();
  }

  clearSensitiveState(): void {
    this.appPassword.value = "";
    this.vaultKey.value = "";
    this.recoveryKey.value = "";
    this.recovery.hidden = true;
  }

  private selectedMode(): "create" | "existing" | "reconnect" {
    if (this.profile.value === CREATE_PROFILE_VALUE) return "create";
    if (this.profile.value === EXISTING_PROFILE_VALUE) return "existing";
    return "reconnect";
  }

  private applySelectedProfile(): void {
    const selected = this.profiles.find((profile) => profile.id === this.profile.value);
    const mode = this.selectedMode();
    const reconnecting = mode === "reconnect" && Boolean(selected);
    this.fields.hidden = false;
    this.actions.hidden = false;
    this.nameField.hidden = reconnecting;
    this.vaultKeyField.hidden = false;
    this.vaultKey.hidden = mode === "create";
    this.localUnlock.hidden = !reconnecting;
    if (!reconnecting) this.localUnlock.open = false;
    this.remove.hidden = !reconnecting;
    this.recoveryKey.value = "";
    this.recovery.hidden = true;
    this.name.value = reconnecting ? (selected?.name ?? "") : "";
    this.endpoint.value = reconnecting ? (selected?.endpoint ?? "") : "";
    this.username.value = "";
    this.appPassword.value = "";
    this.vaultKey.value = "";
    this.localUnlockPassword.value = "";
    if (mode === "create") {
      this.taskHint.textContent = "创建新的加密密码库，完成后请立即保存 Vault Key。";
      this.save.textContent = "创建密码库";
    } else if (mode === "existing") {
      this.taskHint.textContent = "使用 Vault Key 打开远端已有密码库，并在本机保存连接名称。";
      this.save.textContent = "连接密码库";
    } else {
      this.taskHint.textContent = selected ? `恢复“${selected.name}”的本次会话连接。地址已为你填好。` : "当前没有可重新连接的本地密码库。";
      this.save.textContent = "重新连接";
    }
    this.updateDisabledStates();
    this.showStatus("");
  }

  private input() {
    return {
      mode: this.selectedMode(),
      vaultId: this.selectedMode() === "reconnect" ? this.profile.value : undefined,
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
    const savingMode = this.selectedMode();
    this.setBusy(true, "save");
    this.showStatus(savingMode === "reconnect" ? "正在重新连接 WebDAV 密码库…" : "正在连接 WebDAV 密码库…");
    let saved = false;
    try {
      const input = this.input();
      await this.requestOrigin(input.endpoint);
      const connection = await send<VaultConnection>({ type: "saveWebDavVault", ...input });
      saved = true;
      await this.open(savingMode === "reconnect" ? connection.profile.id : undefined);
      window.dispatchEvent(new Event("unipass-vault-changed"));
      if (connection.recoveryKey) this.showRecoveryKey(connection.recoveryKey);
      this.showStatus(connection.recoveryKey ? "WebDAV 密码库已保存并连接。请保存下方 Vault Key" : savingMode === "existing" ? "已有 WebDAV 密码库已连接" : "WebDAV 密码库已重新连接");
    } catch (error) {
      this.showStatus(errorText(error), true);
    } finally {
      if (saved) { this.appPassword.value = ""; this.vaultKey.value = ""; }
      this.setBusy(false);
    }
  }

  private async localUnlockAction(action: "enable" | "unlock" | "lock" | "disable"): Promise<void> {
    const vaultId = this.profile.value;
    if (this.selectedMode() !== "reconnect" || !this.profiles.some((profile) => profile.id === vaultId) || this.busy) return;
    try {
      if (action === "enable") await send<void>({ type: "enableLocalUnlock", vaultId, password: this.localUnlockPassword.value });
      else if (action === "unlock") await send<void>({ type: "unlockVaultLocally", vaultId, password: this.localUnlockPassword.value });
      else if (action === "lock") await send<void>({ type: "lockVault", vaultId });
      else await send<void>({ type: "disableLocalUnlock", vaultId });
      this.localUnlockPassword.value = "";
      this.showStatus(action === "enable" ? "本地解锁已启用" : action === "unlock" ? "Vault 已解锁" : action === "lock" ? "Vault 已锁定" : "本地解锁已停用");
    } catch (error) { this.showStatus(errorText(error), true); }
  }

  private async removeVault(): Promise<void> {
    const selected = this.profiles.find((profile) => profile.id === this.profile.value);
    if (this.busy || !selected) return;
    if (!window.confirm(`删除“${selected.name}”吗？这只会移除扩展中的连接信息，不会删除 WebDAV 服务器上的加密数据。`)) return;
    this.setBusy(true, "remove");
    this.showStatus("正在删除密码库…");
    try {
      await send<void>({ type: "removeVault", vaultId: selected.id });
      this.clearSensitiveState();
      await this.open();
      window.dispatchEvent(new Event("unipass-vault-changed"));
      this.showStatus("密码库已从扩展中移除；WebDAV 服务器上的加密数据未删除");
    } catch (error) {
      this.showStatus(errorText(error), true);
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean, operation: "test" | "save" | "remove" | null = null): void {
    this.busy = busy;
    this.operation = busy ? operation : null;
    this.updateDisabledStates();
    this.test.textContent = this.operation === "test" ? "测试中…" : "仅测试";
    this.save.textContent = this.operation === "save" ? "连接中…" : this.selectedMode() === "reconnect" ? "重新连接" : this.selectedMode() === "existing" ? "连接密码库" : "创建密码库";
    this.remove.textContent = this.operation === "remove" ? "删除中…" : "删除密码库";
  }

  private updateDisabledStates(): void {
    const selected = this.profiles.some((profile) => profile.id === this.profile.value);
    for (const control of [this.profile, this.name, this.endpoint, this.username, this.appPassword, this.vaultKey, this.localUnlockPassword, this.enableLocalUnlock, this.unlockLocalUnlock, this.lock, this.disableLocalUnlock, this.remove, this.test, this.save]) control.disabled = this.busy;
    const reconnectUnavailable = this.selectedMode() === "reconnect" && !selected;
    this.test.disabled = this.busy || reconnectUnavailable;
    this.save.disabled = this.busy || reconnectUnavailable;
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
