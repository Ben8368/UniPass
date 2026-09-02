import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/url.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { appUrlMatches, isHttpsUrl, normalizeTargetUrl } = await import(moduleUrl);

test("only HTTPS URLs are accepted as credential targets", () => {
  assert.equal(isHttpsUrl("https://example.com/login"), true);
  assert.equal(isHttpsUrl("http://example.com/login"), false);
  assert.equal(isHttpsUrl("not-a-url"), false);
});

test("root applications can match routes on the same HTTPS origin", () => {
  assert.equal(appUrlMatches("https://example.com/", "https://example.com/login"), true);
  assert.equal(appUrlMatches("https://example.com/", "https://other.example.com/login"), false);
});

test("path-scoped applications do not match sibling applications", () => {
  assert.equal(appUrlMatches("https://example.com/app-a", "https://example.com/app-a/login"), true);
  assert.equal(appUrlMatches("https://example.com/app-a", "https://example.com/app-b/login"), false);
});

test("HTTP application records never match fill targets", () => {
  assert.equal(appUrlMatches("http://example.com/", "http://example.com/login"), false);
  assert.equal(appUrlMatches("http://example.com/", "https://example.com/login"), false);
});

test("normal query strings are ignored while Huaban and Gaoding queries stay scoped", () => {
  assert.equal(normalizeTargetUrl("https://example.com/login?next=%2Fhome#form"), "https://example.com/login");
  assert.equal(appUrlMatches("https://huaban.com/login?tenant=a", "https://huaban.com/login?tenant=b"), false);
  assert.equal(appUrlMatches("https://gaoding.com/login?team=a", "https://gaoding.com/login?team=a#form"), true);
});
