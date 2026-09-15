import type { BrowserImportDuplicateStrategy, BrowserPasswordImportPreview, BrowserPasswordImportResult } from "../shared/types";
import type { VaultProfile } from "../shared/vault";
import { parseBrowserPasswordCsv, type NormalizedBrowserPasswordImportRecord } from "../shared/import/normalize";
import { send } from "./bridge";
import { errorText, get } from "./dom";

export class BrowserPasswordImportController {
  private readonly input = get<HTMLInputElement>("browserPasswordCsv");
  private readonly button = get<HTMLButtonElement>("importBrowserPasswords");
  private readonly dialog = get<HTMLDivElement>("browserImportDialog");
  private readonly summary = get<HTMLElement>("browserImportSummary");
  private readonly preview = get<HTMLElement>("browserImportPreview");
  private readonly vault = get<HTMLSelectElement>("browserImportVault");
  private readonly strategy = get<HTMLSelectElement>("browserImportStrategy");
  private readonly start = get<HTMLButtonElement>("startBrowserImport");
  private readonly cancel = get<HTMLButtonElement>("cancelBrowserImport");
  private readonly cancelSecondary = get<HTMLButtonElement>("cancelBrowserImportSecondary");
  private records: NormalizedBrowserPasswordImportRecord[] = [];

  constructor(private readonly reportStatus: (text: string, isError?: boolean) => void) {}

  bind(): void {
    this.button.addEventListener("click", () => this.input.click());
    this.input.addEventListener("change", () => void this.readFile());
    this.cancel.addEventListener("click", () => this.close());
    this.cancelSecondary.addEventListener("click", () => this.close());
    this.start.addEventListener("click", () => void this.import());
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
  }

  dispose(): void { this.clearSensitiveState(); }

  private async readFile(): Promise<void> {
    const file = this.input.files?.[0];
    if (!file) return;
    try {
      const parsed = parseBrowserPasswordCsv(await file.text());
      this.records = parsed.records;
      const profiles = await send<VaultProfile[]>({ type: "listVaultProfiles" });
      if (!profiles.length) throw new Error("请先添加一个 WebDAV 密码库");
      this.vault.replaceChildren(...profiles.map((profile) => new Option(profile.name, profile.id)));
      const preview = await send<BrowserPasswordImportPreview>({ type: "previewBrowserPasswords", vaultId: this.vault.value, records: this.records });
      this.summary.textContent = `准备导入 ${parsed.records.length + parsed.invalid} 条\n有效：${preview.valid}\n重复：${preview.duplicate}\n无效：${preview.invalid}`;
      this.preview.replaceChildren(...parsed.records.slice(0, 100).map((record) => {
        const row = document.createElement("div");
        row.className = "browser-import-row";
        row.append(this.text(record.target.host), this.text(record.username), this.text("••••••••"));
        return row;
      }));
      this.dialog.classList.remove("hidden");
      this.start.disabled = false;
    } catch (error) {
      this.clearSensitiveState();
      this.reportStatus(errorText(error), true);
    }
  }

  private async import(): Promise<void> {
    if (!this.records.length || !this.vault.value) return;
    this.start.disabled = true;
    try {
      const result = await send<BrowserPasswordImportResult>({
        type: "importBrowserPasswords",
        vaultId: this.vault.value,
        records: this.records,
        strategy: this.strategy.value as BrowserImportDuplicateStrategy,
      });
      const sync = result.sync.state === "synced" ? "WebDAV 同步完成" : result.sync.state === "offline" ? "待网络恢复后同步" : result.sync.state === "conflict" ? "存在同步冲突" : "待同步";
      this.showComplete(result, sync);
      this.reportStatus(`迁移完成：成功 ${result.added}，跳过 ${result.skipped}，失败 ${result.failed.length}；${sync}`);
      window.dispatchEvent(new Event("unipass-vault-changed"));
    } catch (error) {
      this.reportStatus(errorText(error), true);
      this.start.disabled = false;
    } finally {
      this.clearSensitiveState();
    }
  }

  private close(): void {
    this.dialog.classList.add("hidden");
    this.clearSensitiveState();
  }

  private showComplete(result: BrowserPasswordImportResult, sync: string): void {
    this.clearSensitiveState();
    this.summary.textContent = `迁移完成\n\n成功导入：${result.added}\n跳过重复：${result.skipped}\n失败：${result.failed.length}\n\n已写入加密 Vault\n已保存到本地离线密码库\nWebDAV 同步状态：${sync}\n\n重要：浏览器导出的 CSV 包含明文密码。请立即删除 CSV 文件，并清空回收站/废纸篓。\n\n如希望停止使用浏览器原生密码管理器，请自行前往 Chrome 或 Edge 密码管理器删除原密码。`;
    this.vault.closest("label")?.setAttribute("hidden", "");
    this.strategy.closest("label")?.setAttribute("hidden", "");
    this.start.hidden = true;
    this.cancel.textContent = "完成";
    this.cancelSecondary.textContent = "完成";
    this.dialog.classList.remove("hidden");
  }

  private clearSensitiveState(): void {
    for (const record of this.records) record.password = "";
    this.records = [];
    this.input.value = "";
    this.preview.replaceChildren();
    this.summary.textContent = "";
    this.start.disabled = true;
    this.start.hidden = false;
    this.vault.closest("label")?.removeAttribute("hidden");
    this.strategy.closest("label")?.removeAttribute("hidden");
    this.cancel.textContent = "取消";
    this.cancelSecondary.textContent = "取消";
  }

  private text(value: string): HTMLSpanElement { const element = document.createElement("span"); element.textContent = value; return element; }
}
