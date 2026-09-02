import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let listener;
const attributes = new Map();
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(value) { listener = value; },
    },
  },
};
globalThis.document = {
  documentElement: {
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
  },
  querySelectorAll() {
    throw new Error("mismatched pages must be rejected before reading form fields");
  },
};
globalThis.location = { href: "https://example.com/app-b/login" };

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/content/content-script.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
await import(moduleUrl);

test("content script rejects credentials when the live document no longer matches the application", () => {
  assert.equal(typeof listener, "function");
  let response;
  listener({
    type: "fillCredentials",
    credential: { username: "tester", password: "" },
    expectedAppUrl: "https://example.com/app-a",
    mode: "all",
  }, {}, (value) => { response = value; });
  assert.deepEqual(response, {
    ok: false,
    usernameFilled: false,
    passwordFilled: false,
    error: "当前页面不属于所选应用，已取消填充",
  });
});
