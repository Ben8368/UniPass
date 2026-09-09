import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

let executed = 0;
const tabs = new Map([
  [1, { id: 1, url: "https://example.com/login", active: true }],
  [2, { id: 2, url: "http://example.com/login", active: true }],
]);
globalThis.chrome = {
  tabs: {
    async get(tabId) { return tabs.get(tabId); },
    async create() {},
  },
  scripting: {
    async executeScript() { executed += 1; return []; },
  },
};

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/background/page-overlay.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const overlay = await import(moduleUrl);

test("page overlay injection requires an HTTPS tab", async () => {
  await overlay.togglePageOverlay(2);
  assert.equal(executed, 0);
  await overlay.togglePageOverlay(1);
  assert.equal(executed, 1);
});

test("manifest exposes only the overlay brand icons to HTTPS pages", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["icons/icon16.png", "icons/icon48.png", "icons/icon128.png"],
    matches: ["https://*/*"],
  }]);
});
