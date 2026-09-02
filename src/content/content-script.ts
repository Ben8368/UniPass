import type { FillRequest, FillResult } from "../shared/types";
import { appUrlMatches } from "../shared/url";

const marker = "data-unipass-minimal-listener";
if (document.documentElement.getAttribute(marker) !== "ready") {
  document.documentElement.setAttribute(marker, "ready");
  chrome.runtime.onMessage.addListener(
    (message: FillRequest, _sender, sendResponse: (result: FillResult) => void) => {
      if (message.type !== "fillCredentials") return;
      sendResponse(fill(message));
    },
  );
}

function fill(request: FillRequest): FillResult {
  if (!appUrlMatches(request.expectedAppUrl, location.href)) {
    return { ok: false, usernameFilled: false, passwordFilled: false, error: "当前页面不属于所选应用，已取消填充" };
  }
  const password = visibleInputs('input[type="password"], input[autocomplete="current-password"]')[0];
  if (!password) {
    return { ok: false, usernameFilled: false, passwordFilled: false, error: "当前页面未找到可见密码框" };
  }

  const username = findUsernameInput(password);
  let usernameFilled = false;
  if (request.mode === "all" && username) {
    setInputValue(username, request.credential.username);
    usernameFilled = true;
  }
  setInputValue(password, request.credential.password);
  password.focus();

  return { ok: true, usernameFilled, passwordFilled: true };
}

function findUsernameInput(password: HTMLInputElement): HTMLInputElement | undefined {
  const preferred = visibleInputs(
    'input[autocomplete="username"], input[type="email"], input[type="tel"], input[name*="user" i], input[id*="user" i], input[name*="email" i], input[id*="email" i], input[name*="account" i], input[id*="account" i]',
  );
  const beforePassword = preferred.filter((input) => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (beforePassword.length) return beforePassword.at(-1);

  return visibleInputs('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')
    .filter((input) => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING)
    .at(-1);
}

function visibleInputs(selector: string): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(selector)).filter((input) => {
    if (input.disabled || input.readOnly) return false;
    const style = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
