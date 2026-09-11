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
const manageSource = await readFile(new URL("../src/manage/manage.ts", import.meta.url), "utf8");

test("WebDAV URLs are HTTPS-only and permission is narrowed to one origin", () => {
  assert.equal(normalizeWebDavUrl("https://nas.example/dav"), "https://nas.example/dav/");
  assert.equal(webDavPermissionOrigin("https://nas.example/dav"), "https://nas.example/*");
  assert.throws(() => normalizeWebDavUrl("http://nas.example/dav"), /HTTPS/);
  assert.throws(() => normalizeWebDavUrl("https://user:secret@nas.example/dav"), /只能包含/);
});

test("management flow handles a denied optional host permission without saving", () => {
  assert.match(manageSource, /chrome\.permissions\.request/);
  assert.match(manageSource, /未授予 WebDAV 主机权限，已取消操作/);
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
