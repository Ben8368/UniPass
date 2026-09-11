import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const popupSource = await readFile(new URL("../src/popup/credentials.ts", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../src/popup/catalog.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/background/service-worker.ts", import.meta.url), "utf8");
const overlaySource = await readFile(new URL("../src/background/page-overlay.ts", import.meta.url), "utf8");

test("Popup delegates credential filling to the Service Worker", () => {
  assert.match(popupSource, /type: "fillFromPopup"/);
  assert.doesNotMatch(popupSource, /chrome\.scripting\.executeScript/);
  assert.match(workerSource, /case "fillFromPopup":\s+return withUserScope\(message\.userScope, \(\) => fillFromPopup\(message\)\)/);
  assert.match(overlaySource, /export async function fillFromPopup/);
});

test("Service Worker rechecks the user scope before filling a credential", () => {
  assert.match(overlaySource, /import \{ assertCurrentUserScope \} from "\.\/user-scope-guard"/);
  assert.match(
    overlaySource,
    /credential = await credentialForAccount\([\s\S]*?await assertCurrentUserScope\(message\.userScope\)[\s\S]*?executeScript/,
  );
  assert.match(
    overlaySource,
    /if \(!injection\?\.documentId\)[\s\S]*?await assertCurrentUserScope\(message\.userScope\)[\s\S]*?sendMessage/,
  );
});

test("application cards use their icon to view accounts while retaining their page-opening action", () => {
  assert.match(catalogSource, /root\.className = "item app-item"/);
  assert.match(catalogSource, /root\.append\(this\.appIcon\(title, app\), main, actions\)/);
  assert.match(catalogSource, /slot\.append\(icon\);\s+return slot/);
  assert.match(catalogSource, /icon\.addEventListener\("click", \(\) => void this\.loadAppAccounts\(app\)\)/);
  assert.match(catalogSource, /const open = button\("打开页面"\);[\s\S]*?open\.addEventListener\("click", \(\) => void this\.openAppPage\(app\)\)/);
});

test("current-page account cards place viewing before filling", () => {
  assert.match(catalogSource, /const view = button\("查看"\);[\s\S]*?actions\.append\(view, fill\)/);
});
