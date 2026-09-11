import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

function storageArea() {
  const values = {};
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(items) { Object.assign(values, items); },
    async remove(key) { delete values[key]; },
  };
}

const wasm = await readFile(new URL("../credential-core/target/wasm32-unknown-unknown/release/credential_core.wasm", import.meta.url));
globalThis.chrome = {
  runtime: {
    getManifest: () => ({ version: "5.3.3" }),
    getURL: (path) => `chrome-extension://unipass/${path}`,
  },
  storage: { local: storageArea(), session: storageArea() },
};

const encryptedPassword = "qXQ6Dp8ayFvr6nTNcQFSTA==";
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === "chrome-extension://unipass/credential-core.wasm") return new Response(wasm);
  if (url === "chrome-extension://unipass/runtime-config.json") {
    return new Response(JSON.stringify({ version: 1, networkPluginVersion: "5.3.2" }));
  }
  if (url.includes("/app/list?")) {
    return new Response(JSON.stringify({
      success: true,
      result: { list: [
        { id: "empty-app", name: "Empty" },
        { id: "usable-app", name: "Usable" },
        { id: "decrypt-app", name: "Decrypt failure" },
        { id: "broken-app", name: "Directory failure" },
      ] },
    }));
  }
  if (url.includes("/app/get_app/url?")) {
    const appId = new URL(url).searchParams.get("appId");
    if (appId === "broken-app") throw new Error("directory unavailable");
    return new Response(JSON.stringify({ success: true, result: `https://${appId}.example/login` }));
  }
  if (url.includes("/app/account/account/list/url?")) {
    const appUrl = new URL(url).searchParams.get("url");
    const appId = new URL(appUrl).hostname.split(".")[0];
    const accounts = appId === "empty-app"
      ? []
      : [{ id: appId === "usable-app" ? "available" : "decrypt-failure" }];
    return new Response(JSON.stringify({ success: true, result: { accounts } }));
  }
  if (url.includes("/app/app_config?")) {
    const accountId = new URL(url).searchParams.get("accountId");
    const password = accountId === "available" ? encryptedPassword : "not-a-valid-ciphertext";
    return new Response(JSON.stringify({ success: true, result: { user: { password } } }));
  }
  throw new Error(`Unexpected request: ${url}`);
};

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/background/credential-availability.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { appsWithAvailableCredentials } = await import(moduleUrl);

test("application cards only include apps with at least one usable credential", async () => {
  const available = await appsWithAvailableCredentials("", "user:test");

  assert.deepEqual(available.apps, [{ id: "usable-app", name: "Usable" }]);
  assert.deepEqual({
    total: available.totalApps,
    empty: available.excludedEmptyCredentialApps,
    verification: available.excludedVerificationFailureApps,
    directory: available.excludedDirectoryFailureApps,
  }, { total: 4, empty: 1, verification: 1, directory: 1 });
  assert.equal(JSON.stringify(available).includes(encryptedPassword), false);
});
