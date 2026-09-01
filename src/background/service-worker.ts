import {
  accountsForApp,
  accountsForUrl,
  appUrlForApp,
  credentialForAccount,
  currentUser,
  listApps,
} from "../shared/api";
import type { BackgroundRequest, BackgroundResponse } from "../shared/types";

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "未知错误";
        sendResponse({ ok: false, error: text });
      });
    return true;
  },
);

function handle(message: BackgroundRequest): Promise<unknown> {
  switch (message.type) {
    case "session":
      return currentUser();
    case "accountsForUrl":
      return accountsForUrl(message.url);
    case "listApps":
      return listApps(message.keyword);
    case "accountsForApp":
      return accountsForApp(message.appId);
    case "appUrl":
      return appUrlForApp(message.appId);
    case "credential":
      return credentialForAccount(message.accountId, message.fallbackUsername);
    default:
      return Promise.reject(new Error("不支持的扩展请求"));
  }
}
