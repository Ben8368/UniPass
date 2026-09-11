import popupCss from "../popup/popup.css";
import componentsCss from "../popup/components.css";
import themeCss from "../popup/theme.css";
import glassCss from "../popup/liquid-glass.css";
import popupHtml from "../popup/popup.html";
import { send } from "../popup/bridge";
import { initializePopup, type PopupHandle } from "../popup/popup";
import type { PageContext } from "../shared/types";

const OVERLAY_ID = "unipass-page-overlay";

const existing = document.getElementById(OVERLAY_ID);
if (existing) {
  existing.dispatchEvent(new Event("unipass-overlay-close"));
  existing.remove();
} else {
  void mount();
}

async function mount(): Promise<void> {
  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  host.style.cssText = "position:fixed;top:16px;right:16px;width:420px;height:min(580px,calc(100vh - 32px));z-index:2147483647;pointer-events:none;background:transparent!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = overlayStyles([popupCss, componentsCss, themeCss, glassCss].join("\n"));
  shadow.append(style);

  const overlayRoot = document.createElement("div");
  overlayRoot.className = "overlay-root";
  overlayRoot.style.pointerEvents = "none";
  const parsed = new DOMParser().parseFromString(popupHtml, "text/html");
  const appWindow = parsed.querySelector<HTMLElement>(".app-window");
  if (!appWindow) return;
  const brandIcon = appWindow.querySelector<HTMLImageElement>(".window-brand > img");
  if (brandIcon) brandIcon.src = chrome.runtime.getURL("icons/icon48.png");
  overlayRoot.append(appWindow);
  shadow.append(overlayRoot);
  document.documentElement.append(host);

  const closeOnOutsidePointer = (event: PointerEvent): void => {
    if (event.composedPath().includes(host)) return;
    closeOverlay();
  };
  const closeOnEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeOverlay();
  };
  let popupHandle: PopupHandle | undefined;
  const closeOverlay = (): void => {
    document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    document.removeEventListener("keydown", closeOnEscape, true);
    removalObserver?.disconnect();
    popupHandle?.dispose();
    host.remove();
  };
  host.addEventListener("unipass-overlay-close", closeOverlay);
  const removalObserver = new MutationObserver(() => {
    if (!host.isConnected) popupHandle?.dispose();
  });
  removalObserver.observe(document.documentElement, { childList: true });
  document.addEventListener("pointerdown", closeOnOutsidePointer, true);
  document.addEventListener("keydown", closeOnEscape, true);

  popupHandle = initializePopup({
    root: shadow,
    storage: createMemoryStorage(),
    overlay: true,
    themeTarget: overlayRoot,
    pageContext: () => send<PageContext>({ type: "pageContext" }),
    openApp: (appId, userScope, vaultId) => send<void>({ type: "openApp", appId, vaultId, userScope }),
  });
}

function overlayStyles(css: string): string {
  return `${css
    .replaceAll(":root[data-theme", ".overlay-root[data-theme")
    .replaceAll(":root", ".overlay-root")}
    :host { all: initial !important; position: fixed !important; top: 16px !important; right: 16px !important; width: 420px !important; height: min(580px, calc(100vh - 32px)) !important; display: block !important; z-index: 2147483647 !important; background: transparent !important; color: initial; font: initial; line-height: normal; pointer-events: none !important; }
    .overlay-root { width: 100%; height: 100%; color-scheme: dark; pointer-events: none; background: transparent !important; }
    .overlay-root > .app-window { width: 100%; height: 100%; border-radius: 28px; pointer-events: auto; }
    .overlay-root > .app-window .content-area { overscroll-behavior: contain; }
    @media (max-width: 460px) { :host { top: 8px !important; right: 8px !important; width: calc(100vw - 16px) !important; height: min(580px, calc(100vh - 16px)) !important; } }
  `;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}
