import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

globalThis.crypto ??= webcrypto;

async function load(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const cryptoApi = await load("src/shared/vault-crypto.ts");
const coreApi = await load("src/background/vault/vault-core.ts");

test("Vault object round-trip uses versioned AES-GCM and fresh nonces", async () => {
  const key = await cryptoApi.generateVaultKey();
  const first = await cryptoApi.encryptVaultObject(key, "app_1234567890123456", "app", { name: "fixture-only-app" });
  const second = await cryptoApi.encryptVaultObject(key, "app_1234567890123456", "app", { name: "fixture-only-app" });
  const firstEnvelope = JSON.parse(new TextDecoder().decode(first));
  const secondEnvelope = JSON.parse(new TextDecoder().decode(second));
  assert.equal(firstEnvelope.formatVersion, 1);
  assert.equal(firstEnvelope.keyVersion, 1);
  assert.equal(firstEnvelope.algorithm, "AES-256-GCM");
  assert.notEqual(firstEnvelope.nonce, secondEnvelope.nonce);
  assert.deepEqual((await cryptoApi.decryptVaultObject(key, first)).payload, { name: "fixture-only-app" });
  await assert.rejects(cryptoApi.decryptVaultObject(key, new Uint8Array(first).fill(0, 0, 1)), /Vault/);
  const unsupported = { ...firstEnvelope, formatVersion: 99 };
  await assert.rejects(cryptoApi.decryptVaultObject(key, new TextEncoder().encode(JSON.stringify(unsupported))), /Vault 数据格式/);
});

test("Vault Key format errors are distinct from encrypted-object decryption failures", async () => {
  await assert.rejects(cryptoApi.importVaultKey("not-a-vault-key"), /Vault Key 格式无效/);
});

test("new Vaults explain when a WebDAV directory already contains unreadable data", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  globalThis.chrome = {
    storage: {
      local: { async get() { return {}; }, async set() {} },
      session: { async get() { return {}; }, async set() {} },
    },
  };
  globalThis.fetch = async (_input, init) => {
    if (init.method === "PROPFIND" && String(_input).endsWith("/objects/")) return new Response("<d:multistatus xmlns:d='DAV:'><d:response><d:href>/dav/objects/manifest.json</d:href><d:getetag>&quot;fixture&quot;</d:getetag></d:response></d:multistatus>", { status: 207 });
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    if (init.method === "MKCOL") return new Response("", { status: 405 });
    if (init.method === "GET") return new Response(JSON.stringify({ formatVersion: 1, id: "manifest", kind: "manifest", keyVersion: 1, algorithm: "AES-256-GCM", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAA" }), { status: 200, headers: { ETag: '"fixture"' } });
    throw new Error(`unexpected ${init.method}`);
  };
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    await assert.rejects(
      vaultService.saveWebDavVault({ mode: "create", name: "fixture vault", endpoint: "https://nas.example/dav", username: "fixture-user", appPassword: "fixture-only-app-password" }),
      /已有密码库数据/,
    );
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("Vault Core keeps credential objects out of directory catalog reads and enforces vault identity", async () => {
  const objects = new Map();
  const gets = [];
  const backend = {
    async connect() {},
    async getManifest() { return objects.get("manifest") || null; },
    async list() { return [...objects].map(([id, value]) => ({ id, revision: value.revision })); },
    async get(id) { gets.push(id); return objects.get(id) || null; },
    async put(id, data, expectedRevision) { if (expectedRevision && objects.get(id)?.revision !== expectedRevision) throw new Error("conflict"); const value = { id, data, revision: `${id}-revision` }; objects.set(id, value); return { id, revision: value.revision }; },
    async delete() {},
  };
  const key = await cryptoApi.generateVaultKey();
  const core = new coreApi.VaultCore("vault-a", backend, key);
  await core.initialize();
  const app = await core.createApp({ name: "fixture app", targets: [{ scheme: "https", host: "example.com" }] });
  const account = await core.createAccount({ appId: app.id, username: "fixture-user", password: "fixture-only-password" });
  gets.length = 0;
  const catalog = await core.catalog();
  assert.equal(catalog.apps.length, 1);
  assert.equal(catalog.accounts.length, 1);
  assert.equal(gets.some((id) => id.startsWith("credential_")), false);
  const storedAccount = [...objects.values()].find((value) => value.id.startsWith("account_"));
  const accountPayload = (await cryptoApi.decryptVaultObject(key, storedAccount.data)).payload;
  assert.equal("password" in accountPayload, false);
  await assert.rejects(core.credential({ vaultId: "vault-b", accountId: account.id }), /Vault 引用不匹配/);
  assert.deepEqual((await core.credential({ vaultId: "vault-a", accountId: account.id })).username, "fixture-user");
});

test("an existing Vault without a session key refuses reconnect without changing its profile", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const profile = { id: "vault-existing", name: "fixture vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  const localWrites = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get() { return { "unipass-vault-profiles": [profile] }; },
        async set(value) { localWrites.push(value); },
      },
      session: {
        async get() { return {}; },
        async set() {},
      },
    },
  };
  globalThis.fetch = async (_input, init) => new Response("", { status: init.method === "MKCOL" ? 405 : 207 });
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    await assert.rejects(
      vaultService.saveWebDavVault({ mode: "reconnect", vaultId: profile.id, name: profile.name, endpoint: profile.endpoint, username: "fixture-user", appPassword: "fixture-only-app-password" }),
      /粘贴 Vault Key/,
    );
    assert.deepEqual(localWrites, []);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("Vault connection state exposes only whether this session can read a profile", async () => {
  const originalChrome = globalThis.chrome;
  const profile = { id: "vault-state", name: "fixture vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  globalThis.chrome = {
    storage: {
      local: { async get() { return { "unipass-vault-profiles": [profile] }; } },
      session: { async get() { return { "unipass-vault-session-secrets": {} }; } },
    },
  };
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    assert.deepEqual(await vaultService.listVaultConnectionStates(), [{ vaultId: profile.id, name: profile.name, connected: false }]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("removing a Vault clears only extension state and its unused host permission", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const profile = { id: "vault-remove", name: "fixture vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  const localWrites = [];
  const sessionWrites = [];
  const permissionRemovals = [];
  let networkCalls = 0;
  globalThis.chrome = {
    storage: {
      local: {
        async get() { return { "unipass-vault-profiles": [profile] }; },
        async set(value) { localWrites.push(value); },
      },
      session: {
        async get() { return { "unipass-vault-session-secrets": { [profile.id]: { username: "fixture-user", appPassword: "fixture-only-app-password", vaultKey: "fixture-key" } } }; },
        async set(value) { sessionWrites.push(value); },
      },
    },
    permissions: { async remove(value) { permissionRemovals.push(value); return true; } },
  };
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("Vault removal must not call WebDAV"); };
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    await vaultService.removeVault(profile.id);
    assert.deepEqual(localWrites, [{ "unipass-vault-profiles": [] }, { "unipass-vault-local-unlocks": {} }]);
    assert.deepEqual(sessionWrites, [{ "unipass-vault-session-secrets": {} }]);
    assert.deepEqual(permissionRemovals, [{ origins: ["https://nas.example/*"] }]);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("existing Vault opens from its encrypted manifest identity without writing profile on wrong key", async () => {
  const objects = new Map();
  const backend = {
    async connect() {}, async getManifest() { return objects.get("manifest") ?? null; },
    async list() { return [...objects.values()].map(({ id, revision }) => ({ id, revision })); },
    async get(id) { return objects.get(id) ?? null; },
    async put(id, data, expectedRevision) { if (expectedRevision && objects.get(id)?.revision !== expectedRevision) throw new Error("conflict"); const value = { id, data, revision: `r-${id}` }; objects.set(id, value); return { id, revision: value.revision }; },
    async delete() {},
  };
  const key = await cryptoApi.generateVaultKey();
  const created = await coreApi.VaultCore.create(crypto.randomUUID(), backend, key);
  const app = await created.createApp({ name: "Device A", targets: [{ scheme: "https", host: "example.com" }] });
  const account = await created.createAccount({ appId: app.id, username: "device-a", password: "fixture-password" });
  const writesBeforeWrongKey = objects.size;
  await assert.rejects(coreApi.VaultCore.open(backend, await cryptoApi.generateVaultKey()), /Vault/);
  assert.equal(objects.size, writesBeforeWrongKey);
  const opened = await coreApi.VaultCore.open(backend, key);
  assert.equal(opened.vaultId, created.vaultId);
  assert.equal((await opened.catalog()).accounts[0].id, account.id);
});

test("Vault Core uses Account username only, preserves password, and tombstones both account and credential", async () => {
  const objects = new Map();
  const backend = {
    async connect() {}, async getManifest() { return objects.get("manifest") ?? null; },
    async list() { return [...objects.values()].map(({ id, revision }) => ({ id, revision })); },
    async get(id) { return objects.get(id) ?? null; },
    async put(id, data, expectedRevision) { if (expectedRevision && objects.get(id)?.revision !== expectedRevision) throw new Error("conflict"); const value = { id, data, revision: `${id}-${Math.random()}` }; objects.set(id, value); return { id, revision: value.revision }; },
    async delete() {},
  };
  const key = await cryptoApi.generateVaultKey();
  const core = await coreApi.VaultCore.create(crypto.randomUUID(), backend, key);
  const app = await core.createApp({ name: "fixture", targets: [{ scheme: "https", host: "example.com" }] });
  const account = await core.createAccount({ appId: app.id, username: "A", password: "secret" });
  const credentialObject = objects.get(`credential_${account.credentialId}`);
  assert.deepEqual(Object.keys((await cryptoApi.decryptVaultObject(key, credentialObject.data)).payload).sort(), ["password"]);
  await core.updateAccount({ ...account, username: "B" });
  assert.deepEqual(await core.credential({ vaultId: core.vaultId, accountId: account.id }), { username: "B", password: "secret" });
  await assert.rejects(core.deleteApp(app.id), /仍包含账号/);
  await core.deleteAccount(account.id);
  await assert.rejects(core.credential({ vaultId: core.vaultId, accountId: account.id }), /已删除/);
  const tombstone = (await cryptoApi.decryptVaultObject(key, objects.get(`credential_${account.credentialId}`).data)).payload;
  assert.equal(typeof tombstone.deletedAt, "number");
  await core.deleteApp(app.id);
});

test("credential availability reserves empty for missing or empty secrets and propagates crypto failures", async () => {
  const objects = new Map();
  const backend = {
    async connect() {}, async getManifest() { return objects.get("manifest") ?? null; },
    async list() { return [...objects.values()].map(({ id, revision }) => ({ id, revision })); },
    async get(id) { return objects.get(id) ?? null; },
    async put(id, data) { const value = { id, data, revision: `r-${id}` }; objects.set(id, value); return { id, revision: value.revision }; }, async delete() {},
  };
  const key = await cryptoApi.generateVaultKey(); const core = await coreApi.VaultCore.create(crypto.randomUUID(), backend, key);
  const app = await core.createApp({ name: "fixture", targets: [{ scheme: "https", host: "example.com" }] });
  const account = await core.createAccount({ appId: app.id, username: "A", password: "" });
  const ref = { vaultId: core.vaultId, accountId: account.id };
  assert.equal(await core.credentialAvailability(ref), "empty");
  objects.get(`credential_${account.credentialId}`).data[0] ^= 1;
  await assert.rejects(core.credentialAvailability(ref), /Vault/);
});

test("local unlock seals session material without plaintext and rejects wrong passwords", async () => {
  const unlockApi = await load("src/background/vault/local-unlock.ts");
  const material = { username: "dav-user", appPassword: "fixture-app-password", vaultKey: "fixture-vault-key" };
  const envelope = await unlockApi.sealLocalUnlockMaterial("fixture-local-password", material);
  assert.equal(JSON.stringify(envelope).includes("fixture-app-password"), false);
  assert.equal(JSON.stringify(envelope).includes("fixture-vault-key"), false);
  await assert.rejects(unlockApi.openLocalUnlockMaterial("wrong-password", envelope), /Vault/);
  assert.deepEqual(await unlockApi.openLocalUnlockMaterial("fixture-local-password", envelope), material);
});
