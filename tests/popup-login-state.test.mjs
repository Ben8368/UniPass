import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const popupSource = await readFile(new URL("../src/popup/popup.ts", import.meta.url), "utf8");
const popupCss = await readFile(new URL("../src/popup/popup.css", import.meta.url), "utf8");

test("one-click login shows progress and refreshes the session while the UI remains open", () => {
  assert.match(popupSource, /LOGIN_REFRESH_INTERVAL_MS = 1_000/);
  assert.match(popupSource, /LOGIN_REFRESH_WINDOW_MS = 2 \* 60 \* 1_000/);
  assert.match(popupSource, /sessionBadge\.classList\.add\("logging-in"\)/);
  assert.match(popupSource, /sessionBadge\.disabled = true/);
  assert.match(popupSource, /sessionBadge\.classList\.remove\("pending", "offline", "logging-in"\)/);
  assert.match(popupSource, /正在后台登录，等待 UniPass 会话确认/);
  assert.match(popupSource, /await catalog\.loadCurrentPage\(\)/);
  assert.match(popupSource, /if \(!sessionBadge\.isConnected\) return/);
});

test("login progress has a visible animated state", () => {
  assert.match(popupCss, /\.session-badge\.logging-in/);
  assert.match(popupCss, /animation: session-login-spin \.7s linear infinite/);
});
