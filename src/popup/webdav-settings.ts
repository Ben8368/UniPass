import type { VaultConnection, VaultProfile } from "../shared/vault";
import { normalizeWebDavUrl } from "../shared/url";
import { send } from "./bridge";
import { errorText, get, getDomRoot } from "./dom";

const ADD_PROFILE_VALUE = "__add__";

export class WebDavSettingsController {
  private readonly form = get<HTMLFormElement>("webdavForm");
  private readonly profile = get<HTMLSelectElement>("webdavVaultProfile");
  private readonly fields = get("webdavConnectionFields");
  private readonly taskHint = get("webdavTaskHint");
  private readonly actions = get("webdavActions");
  private readonly name = get<HTMLInputElement>("webdavVaultName");
  private readonly picker = get("webdavVaultProfileField");
  private readonly vaultPicker = get("webdavVaultPicker");
  private readonly selection = get<HTMLButtonElement>("webdavVaultSelection");
  private readonly selectionText = get("webdavVaultSelectionText");
  private readonly menu = get<HTMLDivElement>("webdavVaultProfileMenu");
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
  private readonly setupSystemAuth = get<HTMLButtonElement>("setupWebDavSystemAuth");
  private readonly enableLocalUnlock = get<HTMLButtonElement>("enableWebDavLocalUnlock");
  private readonly unlockAdvanced = get<HTMLButtonElement>("unlockWebDavAdvanced");
  private profiles: VaultProfile[] = [];
  private busy = false;
  private operation: "test" | "save" | "remove" | null = null;

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly onAdvancedUnlock: () => void = () => {},
    private readonly onSystemAuthSetup: () => void = () => {},
  ) {}

  bind(): void {
    this.form.addEventListener("submit", (event) => { event.preventDefault(); void this.saveVault(); });
    this.remove.addEventListener("click", () => void this.removeVault());
    this.test.addEventListener("click", () => void this.testConnection());
    this.selection.addEventListener("click", () => this.toggleProfilePicker());
    this.selection.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeProfilePicker();
      if (event.key === "ArrowDown") this.openProfilePicker();
    });
    this.menu.addEventListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLButtonElement>("[data-vault-profile]");
      if (option?.dataset.vaultProfile) this.selectProfile(option.dataset.vaultProfile);
    });
    getDomRoot().addEventListener("pointerdown", (event) => {
      if (!event.composedPath().includes(this.picker)) this.closeProfilePicker();
    });
    this.enableLocalUnlock.addEventListener("click", () => void this.setGlobalPin());
    this.setupSystemAuth.addEventListener("click", () => this.onSystemAuthSetup());
    this.unlockAdvanced.addEventListener("click", () => this.onAdvancedUnlock());
  }

  async open(vaultId?: string): Promise<void> {
    try {
      this.showStatus("");
      this.profiles = await send<VaultProfile[]>({ type: "listVaultProfiles" });
      this.profile.replaceChildren(
        new Option("添加密码库", ADD_PROFILE_VALUE),
        ...this.profiles.map((profile) => new Option(profile.name, profile.id)),
      );
      const selectedVaultId = vaultId && this.profiles.some((profile) => profile.id === vaultId) ? vaultId : "";
      this.profile.value = selectedVaultId || ADD_PROFILE_VALUE;
      this.renderProfileOptions();
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
    this.localUnlockPassword.value = "";
    this.recoveryKey.value = "";
    this.recovery.hidden = true;
  }

  readGlobalPin(): string { return this.localUnlockPassword.value.trim(); }
  clearGlobalPin(): void { this.localUnlockPassword.value = ""; }

  private selectedMode(): "create" | "existing" | "reconnect" {
    if (this.profile.value !== ADD_PROFILE_VALUE) return "reconnect";
    return this.vaultKey.value.trim() ? "existing" : "create";
  }

  private applySelectedProfile(): void {
    const selected = this.profiles.find((profile) => profile.id === this.profile.value);
    const reconnecting = Boolean(selected);
    this.fields.hidden = false;
    this.actions.hidden = false;
    this.vaultPicker.classList.toggle("has-remove", reconnecting);
    this.vaultKeyField.hidden = false;
    this.vaultKey.hidden = false;
    this.localUnlock.hidden = false;
    this.localUnlock.open = true;
    this.remove.hidden = !reconnecting;
    this.recoveryKey.value = "";
    this.recovery.hidden = true;
    this.name.value = reconnecting ? (selected?.name ?? "") : "";
    this.endpoint.value = reconnecting ? (selected?.endpoint ?? "") : "";
    this.selectionText.textContent = selected?.name ?? "添加密码库";
    this.username.value = "";
    this.appPassword.value = "";
    this.vaultKey.value = "";
    this.localUnlockPassword.value = "";
    if (reconnecting) {
      this.taskHint.textContent = selected ? `“${selected.name}”的连接材料已长期保存在本机，地址已为你填好；直接保存即可，填写新凭据可替换。` : "当前没有可重新连接的本地密码库。";
      this.save.textContent = "重新连接";
    } else {
      this.taskHint.textContent = "留空将新建密码库；粘贴已有 Vault Key 则接入远端密码库。";
      this.save.textContent = "添加密码库";
    }
    this.updateDisabledStates();
    this.showStatus("");
  }

  private renderProfileOptions(): void {
    const options = [
      { value: ADD_PROFILE_VALUE, label: "添加密码库", detail: "新建，或用 Vault Key 接入远端密码库" },
      ...this.profiles.map((profile) => ({ value: profile.id, label: profile.name, detail: "本地已保存的连接" })),
    ];
    this.menu.replaceChildren(...options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.vaultProfile = option.value;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === this.profile.value));
      const label = document.createElement("span");
      label.textContent = option.label;
      const detail = document.createElement("small");
      detail.textContent = option.detail;
      button.append(label, detail);
      return button;
    }));
  }

  private openProfilePicker(): void {
    if (this.busy) return;
    this.renderProfileOptions();
    this.menu.hidden = false;
    this.selection.setAttribute("aria-expanded", "true");
  }

  private toggleProfilePicker(): void {
    if (this.menu.hidden) this.openProfilePicker();
    else this.closeProfilePicker();
  }

  private closeProfilePicker(): void {
    this.menu.hidden = true;
    this.selection.setAttribute("aria-expanded", "false");
  }

  private selectProfile(value: string): void {
    this.profile.value = value;
    this.closeProfilePicker();
    this.applySelectedProfile();
  }

  private input() {
    const endpoint = normalizeWebDavUrl(this.endpoint.value);
    const mode = this.selectedMode();
    return {
      mode,
      vaultId: mode === "reconnect" ? this.profile.value : undefined,
      name: this.name.value.trim() || new URL(endpoint).hostname,
      endpoint,
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
      await this.open(connection.profile.id);
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

  private async setGlobalPin(): Promise<void> {
    if (this.busy) return;
    try {
      await send<void>({ type: "setGlobalPin", pin: this.readGlobalPin() });
      this.showStatus("备用全局 PIN 已设置；系统验证不可用时可用它查看账号密码和高级功能");
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
    this.save.textContent = this.operation === "save" ? "连接中…" : this.selectedMode() === "reconnect" ? "重新连接" : "添加密码库";
    this.remove.title = this.operation === "remove" ? "正在删除密码库" : "删除密码库";
    this.remove.setAttribute("aria-label", this.remove.title);
  }

  private updateDisabledStates(): void {
    const selected = this.profiles.some((profile) => profile.id === this.profile.value);
    for (const control of [this.profile, this.name, this.selection, this.endpoint, this.username, this.appPassword, this.vaultKey, this.localUnlockPassword, this.setupSystemAuth, this.enableLocalUnlock, this.unlockAdvanced, this.remove, this.test, this.save]) control.disabled = this.busy;
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
