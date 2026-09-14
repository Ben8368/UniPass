import { buildSelfDerivedBuild, validateSelfBuildTarget } from "./self-builder";
import { errorText, get } from "./dom";

export class SelfBuildDialogController {
  private readonly dialog = get("selfBuildDialog");
  private readonly closeButton = get<HTMLButtonElement>("closeSelfBuild");
  private readonly cancelButton = get<HTMLButtonElement>("cancelSelfBuild");
  private readonly generateButton = get<HTMLButtonElement>("generateSelfBuild");
  private readonly currentVersion = get("selfBuildCurrentVersion");
  private readonly targetVersion = get("selfBuildTargetVersion");
  private readonly targetNetworkVersion = get("selfBuildTargetNetworkVersion");
  private readonly message = get("selfBuildMessage");
  private readonly saveButton = get<HTMLButtonElement>("versionSave");
  private promptOpen = false;
  private busy = false;

  constructor(
    private readonly reportStatus: (text: string, isError?: boolean) => void,
    private readonly setSaveControlsDisabled: (disabled: boolean) => void,
  ) {}

  get isOpen(): boolean {
    return this.promptOpen;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  bind(): void {
    this.closeButton.addEventListener("click", () => this.close());
    this.cancelButton.addEventListener("click", () => this.close());
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
    this.generateButton.addEventListener("click", () => void this.generate());
  }

  open(target: string): void {
    try {
      const current = chrome.runtime.getManifest().version;
      const network = validateSelfBuildTarget(target, current);
      this.currentVersion.textContent = current;
      this.targetVersion.textContent = target;
      this.targetNetworkVersion.textContent = network;
      this.message.textContent = "将复制当前 runtime 文件并生成 ZIP；不会修改当前扩展。";
      this.generateButton.hidden = false;
      this.cancelButton.textContent = "取消";
      this.promptOpen = true;
      this.dialog.classList.remove("hidden");
      this.generateButton.focus();
    } catch (error) {
      this.reportStatus(errorText(error), true);
    }
  }

  close(): void {
    if (this.busy) return;
    this.promptOpen = false;
    this.dialog.classList.add("hidden");
    this.generateButton.hidden = false;
    this.cancelButton.textContent = "取消";
    this.message.textContent = "";
    this.saveButton.focus();
  }

  private async generate(): Promise<void> {
    if (!this.promptOpen || this.busy) return;
    this.busy = true;
    this.setSaveControlsDisabled(true);
    this.generateButton.disabled = true;
    this.cancelButton.disabled = true;
    this.closeButton.disabled = true;
    this.message.textContent = "正在读取当前 runtime 文件并生成 ZIP…";
    try {
      const result = await buildSelfDerivedBuild(this.targetVersion.textContent ?? "");
      this.message.textContent = `已生成 ${result.fileName}\nLocal Build Version: ${result.targetLocalVersion}\nX-Browser-Plugin-Version: ${result.targetNetworkVersion}\n\n解压后覆盖/替换当前扩展目录，然后在 chrome://extensions 中重新加载。`;
      this.generateButton.hidden = true;
      this.cancelButton.disabled = false;
      this.cancelButton.textContent = "关闭";
      this.reportStatus(`已生成 UniPass ${result.targetLocalVersion}`);
    } catch (error) {
      this.message.textContent = errorText(error);
      this.reportStatus(errorText(error), true);
      this.cancelButton.disabled = false;
      this.cancelButton.textContent = "关闭";
    } finally {
      this.busy = false;
      this.setSaveControlsDisabled(false);
      this.closeButton.disabled = false;
    }
  }
}
