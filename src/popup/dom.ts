export interface DomStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let domRoot: Document | ShadowRoot = document;

export function setDomRoot(root: Document | ShadowRoot): void {
  domRoot = root;
}

export function get<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = domRoot.querySelector(`#${id}`);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

export function queryAll<T extends Element = Element>(selector: string): T[] {
  return Array.from(domRoot.querySelectorAll<T>(selector));
}

export function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function button(label: string, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

export function accountIcon(): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>';
  return icon;
}

export function loading(text: string): string {
  return `<div class="empty loading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-5.3-7.5" /></svg><span>${escapeHtml(text)}</span></div>`;
}

export function empty(text: string): string {
  return `<div class="empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5h14v11H5zM8 7.5V5h8v2.5M9 12h6" /></svg><span>${escapeHtml(text)}</span></div>`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
