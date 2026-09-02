import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import CryptoJS from "crypto-js";
import { build } from "esbuild";

function storageArea() {
  const values = {};
  return {
    async get(keys) {
      if (typeof keys === "string") return { [keys]: values[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, values[key]]));
      return { ...values };
    },
    async set(items) {
      Object.assign(values, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

globalThis.chrome = { runtime: { getManifest: () => ({ version: "5.3.1" }) }, storage: { local: storageArea() } };

let updateRequests = 0;
let portalRequests = 0;
const submittedPluginVersions = [];
let appListMode = "missing";
const passwordKey = CryptoJS.enc.Base64.parse("VlXCSJg7qO66MNrMMJir3g==");
const encryptedPassword = CryptoJS.AES.encrypt("secret", passwordKey, {
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7,
}).toString();

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://clients2.google.com/")) {
    updateRequests += 1;
    return {
      ok: true,
      status: 200,
      url: "https://clients2.googleusercontent.com/crx/blobs/example_5_4_1.crx",
      async json() { return null; },
    };
  }

  portalRequests += 1;
  submittedPluginVersions.push(init?.headers?.["X-Browser-Plugin-Version"]);
  let result;
  if (url.endsWith("/login/isLogin")) result = true;
  else if (url.endsWith("/session/current_user")) result = { id: "user-1", username: "tester", nickName: "private nickname" };
  else if (url.includes("/app/list?")) {
    result = appListMode === "too-many-pages"
      ? { list: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })), pages: 21 }
      : {};
  }
  else if (url.includes("accountId=empty")) result = { user: { username: "empty", password: "" } };
  else if (url.includes("accountId=available")) result = { user: { username: "available", password: encryptedPassword } };
  else throw new Error(`Unexpected request: ${url}`);
  return {
    ok: true,
    status: 200,
    url,
    async json() { return { success: true, result }; },
  };
};

const buildResult = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/api.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = buildResult.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const api = await import(moduleUrl);

test("portal requests declare the store baseline rather than the locally loaded replacement version", async () => {
  const user = await api.currentUser();
  assert.equal(user.nickName, "private nickname");
  await api.currentUser();
  const settings = await api.pluginVersionSettings();
  assert.deepEqual(settings, {
    localBuildVersion: "5.3.1",
    networkVersion: "5.3.0",
    storeBaselineVersion: "5.3.0",
    override: "",
    source: "store-baseline",
  });
  assert.equal(updateRequests, 0);
  assert.equal(portalRequests, 4);
  assert.deepEqual(submittedPluginVersions, ["5.3.0", "5.3.0", "5.3.0", "5.3.0"]);
});

test("a validated manual network version override is persisted and can be cleared", async () => {
  const manual = await api.setPluginVersionOverride("5.4.0");
  assert.equal(manual.networkVersion, "5.4.0");
  assert.equal(manual.source, "manual");
  await api.currentUser();
  assert.deepEqual(submittedPluginVersions.slice(-2), ["5.4.0", "5.4.0"]);
  await assert.rejects(api.setPluginVersionOverride("not-a-version"), /三段数字版号/);
  const restored = await api.setPluginVersionOverride("");
  assert.equal(restored.networkVersion, "5.3.0");
  assert.equal(restored.source, "store-baseline");
});

test("credential availability distinguishes empty and usable passwords without returning either password", async () => {
  assert.equal(await api.credentialAvailableForAccount("empty"), false);
  assert.equal(await api.credentialAvailableForAccount("available"), true);
  assert.equal(updateRequests, 0);
});

test("application list rejects a missing list instead of treating it as a complete empty catalog", async () => {
  appListMode = "missing";
  await assert.rejects(api.listApps(""), /应用列表返回格式异常/);
});

test("application list rejects pagination beyond the safety limit instead of returning a truncated catalog", async () => {
  appListMode = "too-many-pages";
  await assert.rejects(api.listApps(""), /账号目录同步未完成/);
});
