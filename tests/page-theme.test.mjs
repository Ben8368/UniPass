import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let page = { root: "rgb(255, 255, 255)", body: "rgb(255, 255, 255)", rootText: "rgb(0, 0, 0)", bodyText: "rgb(0, 0, 0)" };
globalThis.document = { documentElement: {}, body: {} };
globalThis.getComputedStyle = (element) => ({
  backgroundColor: element === globalThis.document.body ? page.body : page.root,
  colorScheme: "normal",
  color: element === globalThis.document.body ? page.bodyText : page.rootText,
});
const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/page-theme.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { detectPageTheme } = await import(moduleUrl);

test("page theme detects light and dark rendered backgrounds", () => {
  assert.equal(detectPageTheme(), "light");
  page = { root: "rgb(15, 18, 22)", body: "rgb(15, 18, 22)", rootText: "rgb(235, 235, 235)", bodyText: "rgb(235, 235, 235)" };
  assert.equal(detectPageTheme(), "dark");
});

test("page theme honors a dark color scheme when no opaque background is present", () => {
  page = { root: "transparent", body: "rgba(0, 0, 0, 0)", rootText: "rgb(255, 255, 255)", bodyText: "rgb(255, 255, 255)" };
  globalThis.getComputedStyle = () => ({ backgroundColor: "transparent", color: "transparent", colorScheme: "dark" });
  assert.equal(detectPageTheme(), "dark");
});
