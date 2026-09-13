import type { AccountCatalogEntry, PageContext } from "../shared/types";
import type { VaultAccount, VaultApp, VaultProfile } from "../shared/vault";
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

  async render(context: PageContext, entries: AccountCatalogEntry[]): Promise<void> {
    const profiles = await send<VaultProfile[]>({ type: "listVaultProfiles" });
    this.container.replaceChildren();
    const panel = document.createElement("section");
    panel.className = "current-page-add";
    panel.append(textElement("strong", "current-page-add-title", "这个页面还没有保存账号"));
    panel.append(textElement("p", "current-page-add-help", "直接添加到当前页面，之后即可一键填入。"));

    if (!profiles.length) {
      const configure = button("先连接 WebDAV", "primary");
      configure.addEventListener("click", this.openSettings);
      panel.append(configure);
      this.container.append(panel);
      return;
    }

    const form = document.createElement("form");
    form.className = "current-page-add-form";
    const vault = document.createElement("select");
    for (const profile of profiles) vault.add(new Option(profile.name, profile.id));
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
