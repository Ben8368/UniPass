import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

const credentialCore = await readFile(new URL("../credential-core/target/wasm32-unknown-unknown/release/credential_core.wasm", import.meta.url));

globalThis.chrome = {
  runtime: {
    getManifest: () => ({ version: "5.3.3" }),
    getURL: (path) => `chrome-extension://unipass/${path}`,
  },
  storage: { local: storageArea() },
};

let updateRequests = 0;
let portalRequests = 0;
const submittedPluginVersions = [];
let appListMode = "missing";
let accountListMode = "malformed";
const encryptedPassword = "qXQ6Dp8ayFvr6nTNcQFSTA==";

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "chrome-extension://unipass/credential-core.wasm") {
    return new Response(credentialCore);
  }
  if (url === "chrome-extension://unipass/runtime-config.json") {
    return new Response(JSON.stringify({ version: 1, networkPluginVersion: "5.3.2" }));
  }
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
  else if (url.includes("/app/account/account/list/url?")) {
    result = accountListMode === "malformed" ? { accounts: [null] } : { accounts: [] };
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
    localBuildVersion: "5.3.3",
    networkVersion: "5.3.2",
    storeBaselineVersion: "5.3.2",
    override: "",
    source: "built-in",
  });
  assert.equal(updateRequests, 0);
  assert.equal(portalRequests, 4);
  assert.deepEqual(submittedPluginVersions, ["5.3.2", "5.3.2", "5.3.2", "5.3.2"]);
});

test("a validated manual network version override is persisted and can be cleared", async () => {
  const manual = await api.setPluginVersionOverride("5.4.0");
  assert.equal(manual.networkVersion, "5.4.0");
  assert.equal(manual.source, "manual");
  await api.currentUser();
  assert.deepEqual(submittedPluginVersions.slice(-2), ["5.4.0", "5.4.0"]);
  await assert.rejects(api.setPluginVersionOverride("not-a-version"), /三段数字版号/);
  const restored = await api.setPluginVersionOverride("");
  assert.equal(restored.networkVersion, "5.3.2");
  assert.equal(restored.source, "built-in");
});

test("credential availability distinguishes empty and usable passwords without returning either password", async () => {
  assert.equal(await api.credentialAvailableForAccount("empty"), false);
  assert.equal(await api.credentialAvailableForAccount("available"), true);
  assert.equal(updateRequests, 0);
});

test("Jupiter credential API returns only the transformed password", async () => {
  const credential = await api.jupiterCredentialForAccount("available", "fallback@example.com");
  assert.deepEqual(credential, {
    username: "available",
    transformedPassword: "0A98F2E95077EA703D622EF7F27392D9FC95129137121CA21F52D036DFCE81F81E18896ECEC80C84",
  });
  assert.equal("password" in credential, false);
});

test("application list rejects a missing list instead of treating it as a complete empty catalog", async () => {
  appListMode = "missing";
  await assert.rejects(api.listApps(""), /应用列表返回格式异常/);
});

test("application list rejects pagination beyond the safety limit instead of returning a truncated catalog", async () => {
  appListMode = "too-many-pages";
  await assert.rejects(api.listApps(""), /账号目录同步未完成/);
});

test("account lists reject malformed records instead of becoming an empty complete catalog", async () => {
  await assert.rejects(api.accountsForUrl("https://example.com/login"), /账号列表包含无效记录|账号列表包含缺少 ID 的记录/);
});
