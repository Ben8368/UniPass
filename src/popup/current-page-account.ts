import type { AccountCatalogEntry, PageContext } from "../shared/types";
import type { VaultAccount, VaultApp, VaultConnectionState } from "../shared/vault";
import { vaultTargetMatches } from "../shared/url";
import { send } from "./bridge";
import { button, errorText, textElement } from "./dom";

export class CurrentPageAccountEditor {
  constructor(
    private readonly container: HTMLElement,
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly refresh: () => Promise<void>,
    private readonly openSettings: () => void,
  ) {}

  async render(context: PageContext, entries: AccountCatalogEntry[], connectionStates?: VaultConnectionState[]): Promise<void> {
    const states = connectionStates ?? await send<VaultConnectionState[]>({ type: "listVaultConnectionStates" });
    this.container.replaceChildren();
    const profiles = states.filter((state) => state.connected);
    const disconnected = states.filter((state) => !state.connected);
    if (!profiles.length) {
      this.renderReconnectState(disconnected);
      return;
    }
    const panel = document.createElement("section");
    panel.className = "current-page-add";
    const heading = document.createElement("div");
    heading.className = "current-page-add-heading";
    const icon = document.createElement("span");
    icon.className = "current-page-add-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 8.5h14v10H5zM8 8.5V6h8v2.5M9 12h6" /><path d="M9 15h6" /></svg>';
    const copy = document.createElement("div");
    copy.className = "current-page-add-copy";
    copy.append(textElement("span", "current-page-add-eyebrow", "WEB DAV"));
    copy.append(textElement("strong", "current-page-add-title", "这个页面还没有保存账号"));
    const connection = textElement("span", "current-page-add-badge", "可保存");
    heading.append(icon, copy, connection);
    panel.append(heading);
    panel.append(textElement("p", "current-page-add-help", "直接添加到当前页面，之后即可一键填入。"));

    const form = document.createElement("form");
    form.className = "current-page-add-form";
    const vault = document.createElement("select");
    for (const profile of profiles) vault.add(new Option(profile.name, profile.vaultId));
    const destination = textElement("p", "current-page-add-destination", "");
    const username = this.input("账号", "text", "例如：name@example.com", "username");
    const password = this.input("密码", "password", "填写要保存的密码", "new-password");
    const remark = this.input("备注（可选）", "text", "例如：工作账号", "off", false);
    const vaultLabel = this.label("保存到", vault);
    const submit = button("保存账号", "primary");
    submit.type = "submit";
    form.append(vaultLabel, destination, username.label, password.label, remark.label, submit);
    const updateDestination = (): void => {
      const existing = this.matchingVaultApp(entries, context.url, vault.value);
      destination.textContent = existing ? `将添加到已有的“${existing.appName}”` : `将创建“${new URL(context.url).hostname}”并保存账号`;
    };
    vault.addEventListener("change", updateDestination);
    updateDestination();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      void this.save({ context, entries, vaultId: vault.value, username: username.input, password: password.input, remark: remark.input, submit });
    });
    panel.append(form);
    this.container.append(panel);
  }

  private renderReconnectState(states: VaultConnectionState[]): void {
    const panel = document.createElement("section");
    panel.className = "current-page-add current-page-reconnect";
    const heading = document.createElement("div");
    heading.className = "current-page-add-heading";
    const icon = document.createElement("span");
    icon.className = "current-page-add-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5z" /><path d="M12 14v2" /></svg>';
    const copy = document.createElement("div");
    copy.className = "current-page-add-copy";
    copy.append(textElement("span", "current-page-add-eyebrow", "WEB DAV"));
    copy.append(textElement("strong", "current-page-add-title", "账号仍在密码库中，需要重新连接"));
    heading.append(icon, copy);
    panel.append(heading);
    panel.append(textElement("p", "current-page-add-help", states.length ? "本机长期保存的 WebDAV 连接材料不可用或已被清除，请重新输入连接信息后读取账号。" : "当前没有可用的 WebDAV 密码库连接。"));
    const actions = document.createElement("div");
    actions.className = "current-page-reconnect-actions";
    if (!states.length) {
      const connect = button("添加 WebDAV 连接", "current-page-reconnect-button");
      connect.addEventListener("click", this.openSettings);
      actions.append(connect);
    }
    for (const state of states) {
      const reconnect = button(`重新连接 ${state.name}`, "current-page-reconnect-button");
      reconnect.addEventListener("click", () => window.dispatchEvent(new CustomEvent("unipass-open-webdav-settings", { detail: { vaultId: state.vaultId } })));
      actions.append(reconnect);
    }
    panel.append(actions);
    this.container.append(panel);
  }

  private input(label: string, type: string, placeholder: string, autocomplete: string, required = true): { label: HTMLLabelElement; input: HTMLInputElement } {
    const input = document.createElement("input");
    input.type = type;
    input.placeholder = placeholder;
    input.setAttribute("autocomplete", autocomplete);
    input.required = required;
    return { label: this.label(label, input), input };
  }

  private label(text: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
    const label = document.createElement("label");
    label.textContent = text;
    label.append(control);
    return label;
  }

  private matchingVaultApp(entries: AccountCatalogEntry[], url: string, vaultId: string): AccountCatalogEntry | undefined {
    return entries.find((entry) => entry.vaultId === vaultId && Boolean(entry.targets?.some((target) => vaultTargetMatches(target, url))));
  }

  private async save({
    context, entries, vaultId, username, password, remark, submit,
  }: {
    context: PageContext;
    entries: AccountCatalogEntry[];
    vaultId: string;
    username: HTMLInputElement;
    password: HTMLInputElement;
    remark: HTMLInputElement;
    submit: HTMLButtonElement;
  }): Promise<void> {
    submit.disabled = true;
    try {
      const current = new URL(context.url);
      let app = this.matchingVaultApp(entries, context.url, vaultId);
      if (!app) {
        const created = await send<VaultApp>({
          type: "createVaultApp",
          vaultId,
          app: { name: current.hostname, targets: [{ scheme: "https", host: current.hostname }] },
        });
        app = { appId: created.id, appName: created.name, appUrl: context.url, accounts: [], vaultId, targets: created.targets };
      }
      await send<VaultAccount>({
        type: "createVaultAccount",
        vaultId,
        account: { appId: String(app.appId), username: username.value.trim(), password: password.value, remark: remark.value.trim() || undefined },
      });
      password.value = "";
      this.reportStatus("当前页面账号已保存");
      await this.refresh();
    } catch (error) {
      this.reportStatus(errorText(error), true);
    } finally {
      submit.disabled = false;
    }
  }
}
