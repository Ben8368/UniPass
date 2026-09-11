import { send } from "../popup/bridge";
import { normalizeWebDavUrl, webDavPermissionOrigin } from "../shared/url";
import type { AccountCatalogResult } from "../shared/types";
import type { VaultAccount, VaultApp, VaultProfile } from "../shared/vault";

const profilesElement = document.querySelector<HTMLDivElement>("#profiles")!;
const appsElement = document.querySelector<HTMLDivElement>("#apps")!;
const accountsElement = document.querySelector<HTMLDivElement>("#accounts")!;
const accountApp = document.querySelector<HTMLSelectElement>("#accountApp")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
let profiles: VaultProfile[] = [];
let selectedVaultId = "";
let catalog: AccountCatalogResult["entries"] = [];

document.querySelector("#refresh")!.addEventListener("click", () => void load());
document.querySelector<HTMLButtonElement>("#testVault")!.addEventListener("click", () => void testVault());
document.querySelector<HTMLFormElement>("#vaultForm")!.addEventListener("submit", (event) => { event.preventDefault(); void saveVault(); });
document.querySelector<HTMLFormElement>("#appForm")!.addEventListener("submit", (event) => { event.preventDefault(); void saveApp(); });
document.querySelector<HTMLFormElement>("#accountForm")!.addEventListener("submit", (event) => { event.preventDefault(); void saveAccount(); });
document.querySelector<HTMLButtonElement>("#removeVault")!.addEventListener("click", () => void removeSelectedVault());
document.querySelector<HTMLButtonElement>("#deleteApp")!.addEventListener("click", () => void deleteSelectedApp());
document.querySelector<HTMLButtonElement>("#deleteAccount")!.addEventListener("click", () => void deleteSelectedAccount());
void load();

async function load(): Promise<void> {
  try {
    profiles = await send<VaultProfile[]>({ type: "listVaultProfiles" });
    selectedVaultId = profiles.some((profile) => profile.id === selectedVaultId) ? selectedVaultId : profiles[0]?.id ?? "";
    renderProfiles();
    const result = selectedVaultId ? await send<{ entries: Array<{ app: VaultApp; accounts: VaultAccount[] }>; failures: Array<{ vaultId: string; error: string }> }>({ type: "vaultCatalog" }) : { entries: [], failures: [] };
    catalog = result.entries.filter((entry) => entry.app.vaultId === selectedVaultId).map((entry) => ({ appId: entry.app.id, appName: entry.app.name, appUrl: entry.app.targets[0] ? `https://${entry.app.targets[0].host}${entry.app.targets[0].pathPrefix || "/"}` : "", accounts: entry.accounts.map((account) => ({ id: account.id, account: account.username, remark: account.remark, vaultId: account.vaultId, appId: account.appId, accountRef: { vaultId: account.vaultId, accountId: account.id } })) }));
    if (result.failures.length) setStatus(result.failures.map((failure) => failure.error).join("；"), true);
    renderCatalog();
  } catch (error) { setStatus(errorText(error), true); }
}

async function testVault(): Promise<void> {
  try {
    const input = vaultInput();
    await requestOrigin(input.endpoint);
    await send<void>({ type: "testWebDavConnection", ...input });
    setStatus("WebDAV 连接和目录权限检查通过");
  } catch (error) { setStatus(errorText(error), true); }
  finally { setValue("appPassword", ""); }
}

async function saveVault(): Promise<void> {
  try {
    const input = vaultInput();
    await requestOrigin(input.endpoint);
    const profile = await send<VaultProfile>({ type: "saveWebDavVault", vaultId: selectedVaultId || undefined, ...input });
    selectedVaultId = profile.id;
    setStatus("WebDAV Vault 已保存");
    await load();
  } catch (error) { setStatus(errorText(error), true); }
  finally { setValue("appPassword", ""); }
}

async function requestOrigin(endpoint: string): Promise<void> {
  const granted = await chrome.permissions.request({ origins: [webDavPermissionOrigin(endpoint)] });
  if (!granted) throw new Error("未授予 WebDAV 主机权限，已取消操作");
}

function vaultInput() {
  const endpoint = normalizeWebDavUrl(value("endpoint"));
  return { name: value("vaultName"), endpoint, username: value("username"), appPassword: value("appPassword") };
}

async function saveApp(): Promise<void> {
  if (!selectedVaultId) return setStatus("请先保存 WebDAV Vault", true);
  try {
    const appId = value("appId");
    const app = { id: appId, vaultId: selectedVaultId, name: value("appName"), targets: [{ scheme: "https" as const, host: value("appHost"), pathPrefix: value("appPath") || undefined }] };
    if (appId) await send<VaultApp>({ type: "updateVaultApp", vaultId: selectedVaultId, app });
    else await send<VaultApp>({ type: "createVaultApp", vaultId: selectedVaultId, app: { name: app.name, targets: app.targets } });
    resetApp(); setStatus("应用已保存"); await load();
  } catch (error) { setStatus(errorText(error), true); }
}

async function saveAccount(): Promise<void> {
  if (!selectedVaultId) return setStatus("请先保存 WebDAV Vault", true);
  try {
    const id = value("accountId");
    if (!id) {
      if (!value("accountPassword")) throw new Error("新增账号必须填写密码");
      await send<VaultAccount>({ type: "createVaultAccount", vaultId: selectedVaultId, account: { appId: accountApp.value, username: value("accountUsername"), remark: value("accountRemark") || undefined, password: value("accountPassword") } });
    } else {
      const existing = findAccount(id);
      if (!existing) throw new Error("账号不存在");
      await send<VaultAccount>({ type: "updateVaultAccount", vaultId: selectedVaultId, account: { ...existing, appId: accountApp.value, username: value("accountUsername"), remark: value("accountRemark") || undefined } });
      if (value("accountPassword")) await send<void>({ type: "updateVaultCredential", vaultId: selectedVaultId, accountId: id, credential: { username: value("accountUsername"), password: value("accountPassword") } });
    }
    resetAccount(); setStatus("账号和凭据已保存"); await load();
  } catch (error) { setStatus(errorText(error), true); }
}

async function removeSelectedVault(): Promise<void> { if (!selectedVaultId) return; try { await send<void>({ type: "removeVault", vaultId: selectedVaultId }); selectedVaultId = ""; setStatus("Vault 已删除"); await load(); } catch (error) { setStatus(errorText(error), true); } }
async function deleteSelectedApp(): Promise<void> { const id = value("appId"); if (!id) return; try { await send<void>({ type: "deleteVaultApp", vaultId: selectedVaultId, appId: id }); resetApp(); await load(); } catch (error) { setStatus(errorText(error), true); } }
async function deleteSelectedAccount(): Promise<void> { const id = value("accountId"); if (!id) return; try { await send<void>({ type: "deleteVaultAccount", vaultId: selectedVaultId, accountId: id }); resetAccount(); await load(); } catch (error) { setStatus(errorText(error), true); } }

function renderProfiles(): void { profilesElement.replaceChildren(...profiles.map((profile) => { const row = document.createElement("button"); row.className = "row"; row.type = "button"; row.innerHTML = `<span>${escapeHtml(profile.name)}<small>${escapeHtml(profile.endpoint || "")}</small></span><span>${profile.id === selectedVaultId ? "当前" : "选择"}</span>`; row.addEventListener("click", () => { selectedVaultId = profile.id; void load(); }); return row; })); document.querySelector<HTMLButtonElement>("#removeVault")!.disabled = !selectedVaultId; }
function renderCatalog(): void { const apps = catalog.map((entry) => entry); appsElement.replaceChildren(...apps.map((entry) => row(entry.appName, entry.appUrl, () => selectApp(entry)))); accountApp.replaceChildren(...apps.map((entry) => { const option = document.createElement("option"); option.value = String(entry.appId); option.textContent = entry.appName; return option; })); const accounts = apps.flatMap((entry) => entry.accounts); accountsElement.replaceChildren(...accounts.map((account) => row(account.account || "未命名", account.remark || entryName(apps, account.appId), () => selectAccount(account)))); }
function selectApp(entry: AccountCatalogResult["entries"][number]): void { setValue("appId", String(entry.appId)); setValue("appName", entry.appName); const url = new URL(entry.appUrl); setValue("appHost", url.hostname); setValue("appPath", url.pathname === "/" ? "" : url.pathname); document.querySelector<HTMLButtonElement>("#deleteApp")!.disabled = false; }
function selectAccount(account: AccountCatalogResult["entries"][number]["accounts"][number]): void { setValue("accountId", String(account.id ?? "")); setValue("accountUsername", account.account || account.email || ""); setValue("accountRemark", account.remark || ""); accountApp.value = String(account.appId || ""); document.querySelector<HTMLButtonElement>("#deleteAccount")!.disabled = false; }
function resetApp(): void { ["appId", "appName", "appHost", "appPath"].forEach((id) => setValue(id, "")); document.querySelector<HTMLButtonElement>("#deleteApp")!.disabled = true; }
function resetAccount(): void { ["accountId", "accountUsername", "accountRemark", "accountPassword"].forEach((id) => setValue(id, "")); document.querySelector<HTMLButtonElement>("#deleteAccount")!.disabled = true; }
function findAccount(id: string): VaultAccount | undefined { return catalog.flatMap((entry) => entry.accounts).find((account) => String(account.id) === id) as VaultAccount | undefined; }
function entryName(apps: AccountCatalogResult["entries"], appId: string | number | undefined): string { return apps.find((entry) => String(entry.appId) === String(appId))?.appName || "无备注"; }
function row(title: string, meta: string, onClick: () => void): HTMLElement { const element = document.createElement("button"); element.type = "button"; element.className = "row"; const main = document.createElement("span"); main.textContent = title; const small = document.createElement("small"); small.textContent = meta; main.append(small); element.append(main); element.addEventListener("click", onClick); return element; }
function value(id: string): string { return document.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() || ""; }
function setValue(id: string, value: string): void { const element = document.querySelector<HTMLInputElement>(`#${id}`); if (element) element.value = value; }
function setStatus(message: string, isError = false): void { status.textContent = message; status.classList.toggle("error", isError); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : "操作失败"; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character)); }
