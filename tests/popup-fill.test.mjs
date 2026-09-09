import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const popupSource = await readFile(new URL("../src/popup/credentials.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/background/service-worker.ts", import.meta.url), "utf8");
const overlaySource = await readFile(new URL("../src/background/page-overlay.ts", import.meta.url), "utf8");

test("Popup delegates credential filling to the Service Worker", () => {
  assert.match(popupSource, /type: "fillFromPopup"/);
  assert.doesNotMatch(popupSource, /chrome\.scripting\.executeScript/);
  assert.match(workerSource, /case "fillFromPopup":\s+return withUserScope\(message\.userScope, \(\) => fillFromPopup\(message\)\)/);
  assert.match(overlaySource, /export async function fillFromPopup/);
});
