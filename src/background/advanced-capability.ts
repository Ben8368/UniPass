export const ADVANCED_MODE_PORT_NAME = "unipass-advanced-mode";

interface AdvancedModeHandshake {
  type: "advancedModeHandshake";
  token: string;
}

interface AdvancedModeEnabled {
  type: "advancedModeEnabled";
}

export interface AdvancedCapability {
  documentId: string;
  port: chrome.runtime.Port;
}

type TokenFactory = () => string;

function documentIdFor(sender: chrome.runtime.MessageSender | undefined): string {
  const extensionId = typeof chrome !== "undefined" ? chrome.runtime.id : undefined;
  if (extensionId && sender?.id !== extensionId) {
    throw new Error("当前上下文不是 UniPass 扩展页面");
  }
  const documentId = sender?.documentId?.trim();
  if (!documentId) throw new Error("当前上下文无法启用高级模式");
  return documentId;
}

function defaultTokenFactory(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export class AdvancedCapabilityRegistry {
  private readonly pending = new Map<string, string>();
  private readonly active = new Map<string, AdvancedCapability>();

  constructor(private readonly tokenFactory: TokenFactory = defaultTokenFactory) {}

  prepare(sender: chrome.runtime.MessageSender | undefined): string {
    const documentId = documentIdFor(sender);
    const token = this.tokenFactory();
    this.pending.set(documentId, token);
    return token;
  }

  attachPort(port: chrome.runtime.Port): void {
    if (port.name !== ADVANCED_MODE_PORT_NAME) return;
    const extensionId = typeof chrome !== "undefined" ? chrome.runtime.id : undefined;
    if (extensionId && port.sender?.id !== extensionId) {
      port.disconnect();
      return;
    }
    const documentId = port.sender?.documentId?.trim();
    if (!documentId) {
      port.disconnect();
      return;
    }
    let attached = false;
    port.onMessage.addListener((message: AdvancedModeHandshake) => {
      if (attached || message?.type !== "advancedModeHandshake") return;
      if (this.pending.get(documentId) !== message.token) {
        port.disconnect();
        return;
      }
      this.pending.delete(documentId);
      this.active.get(documentId)?.port.disconnect();
      const capability: AdvancedCapability = { documentId, port };
      this.active.set(documentId, capability);
      attached = true;
      port.onDisconnect.addListener(() => {
        if (this.active.get(documentId)?.port === port) this.active.delete(documentId);
      });
      const response: AdvancedModeEnabled = { type: "advancedModeEnabled" };
      port.postMessage(response);
    });
  }

  require(sender: chrome.runtime.MessageSender | undefined): AdvancedCapability {
    const documentId = documentIdFor(sender);
    const capability = this.active.get(documentId);
    if (!capability) throw new Error("当前上下文未启用高级模式");
    return capability;
  }

  clear(): void {
    for (const capability of this.active.values()) capability.port.disconnect();
    this.active.clear();
    this.pending.clear();
  }
}
