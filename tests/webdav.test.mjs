import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

async function load(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { WebDavBackend } = await load("src/background/vault/webdav-backend.ts");
const { normalizeWebDavUrl, webDavPermissionOrigin } = await load("src/shared/url.ts");
const manageHtml = await readFile(new URL("../src/manage/manage.html", import.meta.url), "utf8");
const manageCss = await readFile(new URL("../src/manage/manage.css", import.meta.url), "utf8");
const manageSource = await readFile(new URL("../src/manage/manage.ts", import.meta.url), "utf8");

test("WebDAV URLs are HTTPS-only and permission is narrowed to one origin", () => {
  assert.equal(normalizeWebDavUrl("https://nas.example/dav"), "https://nas.example/dav/");
  assert.equal(webDavPermissionOrigin("https://nas.example/dav"), "https://nas.example/*");
  assert.throws(() => normalizeWebDavUrl("http://nas.example/dav"), /HTTPS/);
  assert.throws(() => normalizeWebDavUrl("https://user:secret@nas.example/dav"), /只能包含/);
});

test("management flow handles a denied optional host permission without saving", () => {
  assert.match(manageHtml, /id="endpoint" required type="text" inputmode="url"/);
  assert.match(manageHtml, /<h1>设置密码库<\/h1>/);
  assert.match(manageHtml, /第 1 步.*连接 WebDAV/s);
  assert.match(manageHtml, /id="appFields" class="form-grid" disabled/);
  assert.match(manageHtml, /id="accountFields" class="form-grid" disabled/);
  assert.match(manageCss, /form \+ \.empty-state\s*\{[^}]*margin-top:\s*18px/s);
  assert.match(manageCss, /\.field-help\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(manageSource, /appFields\.disabled = !enabled/);
  assert.match(manageSource, /accountFields\.disabled = !enabled/);
  assert.match(manageSource, /chrome\.permissions\.request/);
  assert.match(manageSource, /未授予 WebDAV 主机权限，已取消操作/);
  assert.match(manageHtml, /<p id="status" class="status" role="status" aria-live="polite" hidden><\/p>/);
  assert.match(manageHtml, /<div class="actions">[\s\S]*<p id="status"/);
  assert.match(manageCss, /\.status\s*\{[^}]*display:\s*inline-flex/s);
  const testVaultBody = manageSource.match(/async function testVault\(\): Promise<void> \{([\s\S]*?)\n\}\n\nasync function saveVault/)?.[1] || "";
  assert.match(testVaultBody, /setStatus\("WebDAV 连接和目录权限检查通过"\);/);
  assert.doesNotMatch(testVaultBody, /finally \{ setValue\("appPassword", ""\); \}/);
  assert.match(manageSource, /async function saveVault\(\): Promise<void>[\s\S]*?finally \{ if \(saved\) setValue\("appPassword", ""\); \}/);
  assert.match(manageSource, /appPassword: rawValue\("appPassword"\)/);
});

test("WebDAV authentication failures identify the server-side 401 without exposing credentials", async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response("", { status: 401 });
  };
  const backend = new WebDavBackend("https://nas.example/dav", "dav-user", "fixture-only-app-password");
  await assert.rejects(backend.connect(), /HTTP 401/);
  assert.equal(calls[0].init.headers.Authorization.includes("fixture-only"), false);
});

test("WebDAV backend uses ETag preconditions and never puts plaintext in the request body", async () => {
  const calls = [];
  let mode = "normal";
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (mode === "conflict") return new Response("", { status: 412 });
    if (mode === "unauthorized") return new Response("", { status: 401 });
    if (init.method === "PROPFIND" && String(input).endsWith("/objects/")) return new Response("<d:multistatus xmlns:d='DAV:'><d:response><d:href>/dav/objects/app_1234567890123456.json</d:href><d:getetag>&quot;old&quot;</d:getetag></d:response></d:multistatus>", { status: 207 });
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    if (init.method === "MKCOL") return new Response("", { status: 405 });
    if (init.method === "GET") return new Response(JSON.stringify({ ciphertext: "opaque" }), { status: 200, headers: { ETag: '"old"' } });
    return new Response("", { status: 201, headers: { ETag: '"new"' } });
  };
  const backend = new WebDavBackend("https://nas.example/dav", "dav-user", "fixture-only-app-password");
  await backend.connect();
  const manifest = await backend.getManifest();
  assert.equal(manifest.id, "manifest");
  assert.equal(calls.find((call) => call.init.method === "GET").url, "https://nas.example/dav/objects/manifest.json");
  const listed = await backend.list();
  assert.deepEqual(listed, [{ id: "app_1234567890123456", revision: '"old"' }]);
  const stored = await backend.get("app_1234567890123456");
  assert.equal(stored.revision, '"old"');
  await backend.put("app_1234567890123456", new TextEncoder().encode('{"ciphertext":"opaque"}'), '"old"');
  const put = calls.find((call) => call.init.method === "PUT");
  assert.equal(put.init.headers["If-Match"], '"old"');
  assert.equal(String(put.init.body).includes("fixture-only"), false);
  await backend.put("account_1234567890123456", new Uint8Array([1, 2, 3]));
  const create = calls.find((call) => call.init.method === "PUT" && call.init.headers["If-None-Match"] === "*");
  assert.equal(create.init.headers["If-None-Match"], "*");
  await backend.delete("app_1234567890123456", '"old"');
  const deletion = calls.find((call) => call.init.method === "DELETE");
  assert.equal(deletion.init.headers["If-Match"], '"old"');
  mode = "conflict";
  await assert.rejects(backend.put("app_1234567890123456", new Uint8Array([1]), '"old"'), /另一台设备修改/);
  const conflictCall = calls.at(-1);
  assert.equal(conflictCall.init.headers.Authorization.includes("fixture-only"), false);
  mode = "unauthorized";
  await assert.rejects(backend.get("app_1234567890123456"), (error) => !error.message.includes("fixture-only") && !error.message.includes("Authorization"));
});
