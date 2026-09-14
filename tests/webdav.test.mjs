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
const popupHtml = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const popupCss = await readFile(new URL("../src/popup/components.css", import.meta.url), "utf8");
const webdavSource = await readFile(new URL("../src/popup/webdav-settings.ts", import.meta.url), "utf8");

test("WebDAV URLs are HTTPS-only and permission is narrowed to one origin", () => {
  assert.equal(normalizeWebDavUrl("https://nas.example/dav"), "https://nas.example/dav/");
  assert.equal(webDavPermissionOrigin("https://nas.example/dav"), "https://nas.example/*");
  assert.throws(() => normalizeWebDavUrl("http://nas.example/dav"), /HTTPS/);
  assert.throws(() => normalizeWebDavUrl("https://user:secret@nas.example/dav"), /只能包含/);
});

test("WebDAV settings handles denied permission without saving and clears secrets after save", () => {
  assert.match(popupHtml, /id="webdavUrl" type="url"/);
  assert.match(popupHtml, /id="webdavUsername" type="text" autocomplete="username"/);
  assert.match(popupHtml, /id="webdavPassword" type="password" autocomplete="new-password"/);
  assert.match(webdavSource, /type: "requestWebDavPermission"/);
  assert.match(webdavSource, /未授予 WebDAV 主机权限，已取消操作/);
  assert.match(webdavSource, /type: "testWebDavConnection"/);
  assert.match(webdavSource, /WebDAV 连接和目录权限检查通过/);
  assert.match(webdavSource, /type: "saveWebDavVault"/);
  assert.match(webdavSource, /if \(saved\) \{ this\.appPassword\.value = ""; this\.vaultKey\.value = ""; \}/);
  assert.match(webdavSource, /type: "removeVault"/);
  assert.match(popupCss, /\.webdav-status\s*\{[^}]*display:\s*flex/s);
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
    if (init.method === "PROPFIND" && String(input).endsWith("/objects/")) return new Response("<d:multistatus xmlns:d='DAV:'><d:response><d:href>/dav/objects/manifest.json</d:href><d:getetag>&quot;manifest&quot;</d:getetag></d:response><d:response><d:href>/dav/objects/app_1234567890123456.json</d:href><d:getetag>&quot;old&quot;</d:getetag></d:response></d:multistatus>", { status: 207 });
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
  assert.deepEqual(listed, [{ id: "manifest", revision: '"manifest"' }, { id: "app_1234567890123456", revision: '"old"' }]);
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

test("an empty WebDAV collection does not treat a fallback GET response as a manifest", async () => {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init.method === "PROPFIND") return new Response("<d:multistatus xmlns:d='DAV:'><d:response><d:href>/dav/objects/</d:href><d:getetag>&quot;collection&quot;</d:getetag></d:response></d:multistatus>", { status: 207 });
    if (init.method === "GET") return new Response("server fallback page", { status: 200, headers: { ETag: '"fallback"' } });
    throw new Error(`unexpected ${init.method}`);
  };
  const backend = new WebDavBackend("https://nas.example/dav", "dav-user", "fixture-only-app-password");
  assert.equal(await backend.getManifest(), null);
  assert.equal(calls.some((call) => call.init.method === "GET"), false);
});

test("MKCOL 409 is not accepted unless PROPFIND verifies objects collection", async () => {
  let objectChecks = 0;
  globalThis.fetch = async (input, init) => {
    if (init.method === "PROPFIND" && String(input).endsWith("/objects/")) {
      objectChecks += 1;
      return new Response("", { status: 404 });
    }
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    if (init.method === "MKCOL") return new Response("", { status: 409 });
    throw new Error(`unexpected ${init.method}`);
  };
  const backend = new WebDavBackend("https://nas.example/dav", "dav-user", "fixture-only-app-password");
  await assert.rejects(backend.connect(), /WebDAV/);
  assert.ok(objectChecks >= 2);
});

test("PROPFIND parser accepts arbitrary DAV namespace prefixes", async () => {
  globalThis.fetch = async (_input, init) => {
    if (init.method === "PROPFIND") return new Response("<ns1:multistatus xmlns:ns1='DAV:'><ns1:response><ns1:href>/dav/objects/app_1234567890123456.json</ns1:href><ns1:getetag>&quot;etag&quot;</ns1:getetag></ns1:response></ns1:multistatus>", { status: 207 });
    throw new Error(`unexpected ${init.method}`);
  };
  const backend = new WebDavBackend("https://nas.example/dav", "dav-user", "fixture-only-app-password");
  assert.deepEqual(await backend.list(), [{ id: "app_1234567890123456", revision: '"etag"' }]);
});

test("physical WebDAV delete requires compare-and-delete revision", async () => {
  globalThis.fetch = async (_input, init) => new Response("", { status: 204 });
  const backend = new WebDavBackend("https://nas.example/dav", "dav-user", "fixture-only-app-password");
  await assert.rejects(backend.delete("app_1234567890123456", undefined), /expectedRevision/);
});
