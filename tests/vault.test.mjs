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

test("Vault connection state exposes whether persistent connection material is available", async () => {
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

test("persistent WebDAV material restores connection state after session storage is empty", async () => {
  const originalChrome = globalThis.chrome;
  const localValues = new Map();
  const profile = { id: "vault-persistent", name: "persistent vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: localValues.get(key) }; },
        async set(values) { for (const [key, value] of Object.entries(values)) localValues.set(key, value); },
      },
      session: { async get() { return {}; }, async set() {} },
    },
  };
  try {
    const persistentApi = await load("src/background/vault/persistent-secrets.ts");
    const envelope = await persistentApi.sealPersistentMaterial({ username: "fixture-user", appPassword: "fixture-only-app-password", vaultKey: "fixture-vault-key" });
    localValues.set("unipass-vault-profiles", [profile]);
    localValues.set("unipass-vault-persistent-connections", { [profile.id]: envelope });
    const vaultService = await load("src/background/vault/vault-service.ts");
    assert.deepEqual(await vaultService.listVaultConnectionStates(), [{ vaultId: profile.id, name: profile.name, connected: true }]);
    assert.equal(JSON.stringify(Object.fromEntries(localValues)).includes("fixture-only-app-password"), false);
    assert.equal(JSON.stringify(Object.fromEntries(localValues)).includes("fixture-vault-key"), false);
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
    assert.deepEqual(localWrites, [{ "unipass-vault-profiles": [], "unipass-vault-local-unlocks": {}, "unipass-vault-persistent-connections": {} }]);
    assert.deepEqual(sessionWrites, [{ "unipass-vault-session-secrets": {} }]);
    assert.deepEqual(permissionRemovals, [{ origins: ["https://nas.example/*"] }]);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("orphan persistent material is ignored and cannot create a usable Vault", async () => {
  const originalChrome = globalThis.chrome;
  const localValues = new Map();
  const area = (values) => ({
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
  });
  globalThis.chrome = { storage: { local: area(localValues), session: { async get() { return {}; }, async set() {} } } };
  try {
    const persistentApi = await load("src/background/vault/persistent-secrets.ts");
    localValues.set("unipass-vault-persistent-connections", {
      "orphan-vault": await persistentApi.sealPersistentMaterial({ username: "fixture-user", appPassword: "fixture-only-app-password", vaultKey: "fixture-vault-key" }),
    });
    const vaultService = await load("src/background/vault/vault-service.ts");
    assert.deepEqual(await vaultService.listVaultProfiles(), []);
    await assert.rejects(vaultService.credentialForRef({ vaultId: "orphan-vault", accountId: "orphan-account" }), /Vault 不存在/);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("an unreadable persistent secret is disconnected and reported as a Vault failure, not an empty catalog", async () => {
  const originalChrome = globalThis.chrome;
  const profile = { id: "vault-unreadable", name: "fixture vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  globalThis.chrome = {
    storage: {
      local: { async get(key) { return key === "unipass-vault-profiles" ? { [key]: [profile] } : { [key]: { [profile.id]: { version: 1, algorithm: "AES-256-GCM", nonce: "bad", ciphertext: "bad" } } }; } },
      session: { async get() { return {}; }, async set() {} },
    },
  };
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    assert.deepEqual(await vaultService.listVaultConnectionStates(), [{ vaultId: profile.id, name: profile.name, connected: false }]);
    const catalog = await vaultService.vaultCatalog();
    assert.deepEqual(catalog.entries, []);
    assert.deepEqual(catalog.failures.map(({ vaultId }) => vaultId), [profile.id]);
  } finally {
    globalThis.chrome = originalChrome;
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

test("reconnect adopts a stale local profile ID from the remote manifest without overwriting data", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const remoteVaultId = "remote-vault-123456";
  const staleProfile = { id: "stale-local-id", name: "fixture vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  const key = await cryptoApi.generateVaultKey();
  const vaultKey = await cryptoApi.exportVaultKey(key);
  const manifestData = await cryptoApi.encryptVaultObject(key, "manifest", "manifest", { vaultId: remoteVaultId, schemaVersion: 1 });
  const localWrites = [];
  const sessionWrites = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(keyName) {
          if (keyName === "unipass-vault-profiles") return { [keyName]: [staleProfile] };
          return {};
        },
        async set(value) { localWrites.push(value); },
      },
      session: {
        async get(keyName) {
          if (keyName === "unipass-vault-session-secrets") return { [keyName]: { [staleProfile.id]: { username: "fixture-user", appPassword: "fixture-only-app-password", vaultKey } } };
          return {};
        },
        async set(value) { sessionWrites.push(value); },
      },
    },
  };
  globalThis.fetch = async (_input, init) => {
    if (init.method === "PROPFIND" && String(_input).endsWith("/objects/")) return new Response(`<d:multistatus xmlns:d='DAV:'><d:response><d:href>/dav/objects/manifest.json</d:href><d:getetag>&quot;manifest&quot;</d:getetag></d:response></d:multistatus>`, { status: 207 });
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    if (init.method === "GET") return new Response(manifestData, { status: 200, headers: { ETag: '"manifest"' } });
    throw new Error(`unexpected ${init.method}`);
  };
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    const result = await vaultService.saveWebDavVault({ mode: "reconnect", vaultId: staleProfile.id, name: staleProfile.name, endpoint: staleProfile.endpoint, username: "fixture-user", appPassword: "fixture-only-app-password" });
    assert.equal(result.profile.id, remoteVaultId);
    assert.equal(localWrites.some((value) => value["unipass-vault-profiles"]?.some((profile) => profile.id === staleProfile.id)), false);
    assert.equal(sessionWrites.some((value) => value["unipass-vault-session-secrets"]?.[remoteVaultId]?.vaultKey === vaultKey), true);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test("a local Vault commit failure leaves the old profile and session state recoverable", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const remoteVaultId = "remote-vault-commit-failure";
  const staleProfile = { id: "stale-local-commit", name: "fixture vault", backend: "webdav", enabled: true, endpoint: "https://nas.example/dav/" };
  const key = await cryptoApi.generateVaultKey();
  const vaultKey = await cryptoApi.exportVaultKey(key);
  const manifestData = await cryptoApi.encryptVaultObject(key, "manifest", "manifest", { vaultId: remoteVaultId, schemaVersion: 1 });
  const localValues = new Map([["unipass-vault-profiles", [staleProfile]]]);
  const localWrites = [];
  const sessionWrites = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(keyName) { return { [keyName]: localValues.get(keyName) }; },
        async set(value) {
          localWrites.push(value);
          if ("unipass-vault-profiles" in value) throw new Error("injected local commit failure");
          for (const [keyName, stored] of Object.entries(value)) localValues.set(keyName, stored);
        },
      },
      session: {
        async get(keyName) { return keyName === "unipass-vault-session-secrets" ? { [keyName]: { [staleProfile.id]: { username: "fixture-user", appPassword: "fixture-only-app-password", vaultKey } } } : {}; },
        async set(value) { sessionWrites.push(value); },
      },
    },
  };
  globalThis.fetch = async (_input, init) => {
    if (init.method === "PROPFIND" && String(_input).endsWith("/objects/")) return new Response(`<d:multistatus xmlns:d='DAV:'><d:response><d:href>/dav/objects/manifest.json</d:href><d:getetag>&quot;manifest&quot;</d:getetag></d:response></d:multistatus>`, { status: 207 });
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    if (init.method === "GET") return new Response(manifestData, { status: 200, headers: { ETag: '"manifest"' } });
    throw new Error(`unexpected ${init.method}`);
  };
  try {
    const vaultService = await load("src/background/vault/vault-service.ts");
    await assert.rejects(vaultService.saveWebDavVault({ mode: "reconnect", vaultId: staleProfile.id, name: staleProfile.name, endpoint: staleProfile.endpoint, username: "fixture-user", appPassword: "fixture-only-app-password" }), /injected local commit failure/);
    assert.deepEqual(localValues.get("unipass-vault-profiles"), [staleProfile]);
    assert.equal(localWrites.filter((value) => "unipass-vault-profiles" in value).length, 1);
    assert.equal("unipass-vault-persistent-connections" in localWrites.find((value) => "unipass-vault-profiles" in value), true);
    assert.deepEqual(sessionWrites, []);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
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

test("global PIN uses the same encrypted envelope without storing the PIN", async () => {
  const unlockApi = await load("src/background/vault/local-unlock.ts");
  const envelope = await unlockApi.sealGlobalPin("123456");
  assert.equal(JSON.stringify(envelope).includes("123456"), false);
  await assert.rejects(unlockApi.openGlobalPin("654321", envelope), /Vault/);
  await unlockApi.openGlobalPin("123456", envelope);
  assert.throws(() => unlockApi.validateGlobalPin("123"), /4 至 32 位数字/);
});

test("system authenticator verifies a user-verified WebAuthn assertion without receiving a PIN", async () => {
  const originalChrome = globalThis.chrome;
  const localValues = new Map();
  const sessionValues = new Map();
  const area = (values) => ({
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
  });
  globalThis.chrome = { storage: { local: area(localValues), session: area(sessionValues) }, runtime: { getURL() { return "https://extension.fixture/"; } } };
  try {
    const systemAuth = await load("src/background/vault/system-auth.ts");
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const register = await systemAuth.beginSystemAuthenticator("register");
    const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("https://extension.fixture")));
    const registrationData = new Uint8Array(37); registrationData.set(rpIdHash); registrationData[32] = 0x05;
    await systemAuth.saveSystemAuthenticator({
      credentialId: "fixture-credential",
      clientDataJSON: base64Url(new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: register.challenge, origin: "https://extension.fixture" }))),
      authenticatorData: base64Url(registrationData),
      publicKey: base64Url(publicKey),
      algorithm: -7,
    });
    const authenticate = await systemAuth.beginSystemAuthenticator("authenticate");
    const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: authenticate.challenge, origin: "https://extension.fixture" }));
    const authenticatorData = new Uint8Array(37); authenticatorData.set(rpIdHash); authenticatorData[32] = 0x05;
    const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData));
    const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length); signedData.set(authenticatorData); signedData.set(clientDataHash, authenticatorData.length);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signedData));
    await systemAuth.verifySystemAuthenticator({ credentialId: "fixture-credential", clientDataJSON: base64Url(clientData), authenticatorData: base64Url(authenticatorData), signature: base64Url(signature) });
    assert.deepEqual(await systemAuth.systemAuthenticatorStatus(), { configured: true });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("system authenticator rejects malformed or replayed assertions, including RP ID mismatch", async (t) => {
  const cases = [
    ["challenge mismatch", (assertion, pending) => { assertion.clientDataJSON = base64Url(new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: "wrong", origin: pending.origin }))); }, /响应不匹配/],
    ["expired challenge", (_assertion, _pending, harness) => { harness.sessionValues.set("unipass-system-auth-pending", { purpose: "authenticate", challenge: harness.challenge, expiresAt: Date.now() - 1 }); }, /请求已失效/],
    ["wrong origin", (assertion, pending) => { assertion.clientDataJSON = base64Url(new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: pending.challenge, origin: "chrome-extension://wrong-extension" }))); }, /响应不匹配/],
    ["wrong credential ID", (assertion) => { assertion.credentialId = "wrong-credential"; }, /不匹配/],
    ["missing user verification", async (assertion, pending) => { assertion.authenticatorData = base64Url(await authenticatorDataFor(pending.origin, 0x01)); }, /用户验证/],
    ["invalid signature", (assertion) => { assertion.signature = base64Url(new Uint8Array(64).fill(7)); }, /验证失败|签名格式/],
    ["wrong RP ID hash", async (assertion, pending) => { assertion.authenticatorData = base64Url(await authenticatorDataFor(pending.origin, 0x05, "chrome-extension://wrong-extension")); }, /RP ID/],
  ];

  for (const [name, mutate, expected] of cases) {
    await t.test(name, async () => {
      const harness = await setupSystemAuthHarness();
      try {
        await registerFixture(harness);
        const pending = await harness.api.beginSystemAuthenticator("authenticate");
        harness.challenge = pending.challenge;
        const assertion = await assertionFixture(harness, pending.challenge);
        await mutate(assertion, { ...pending, origin: harness.origin }, harness);
        await assert.rejects(harness.api.verifySystemAuthenticator(assertion), expected);
      } finally {
        harness.restore();
      }
    });
  }

  await t.test("same challenge cannot be replayed", async () => {
    const harness = await setupSystemAuthHarness();
    try {
      await registerFixture(harness);
      const pending = await harness.api.beginSystemAuthenticator("authenticate");
      const assertion = await assertionFixture(harness, pending.challenge);
      await harness.api.verifySystemAuthenticator(assertion);
      await assert.rejects(harness.api.verifySystemAuthenticator(assertion), /请求已失效/);
    } finally {
      harness.restore();
    }
  });
});

test("replacing an existing system authenticator requires current auth or the configured fallback PIN", async () => {
  const harness = await setupSystemAuthHarness();
  try {
    await registerFixture(harness);
    await assert.rejects(harness.api.beginSystemAuthenticator("register"), /已有系统验证器/);
    const pending = await harness.api.beginSystemAuthenticator("authenticate");
    const assertion = await assertionFixture(harness, pending.challenge);
    const replacement = await harness.api.beginSystemAuthenticator("register", assertion);
    assert.equal(typeof replacement.challenge, "string");
  } finally {
    harness.restore();
  }
});

async function setupSystemAuthHarness() {
  const originalChrome = globalThis.chrome;
  const localValues = new Map();
  const sessionValues = new Map();
  const area = (values) => ({
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
  });
  // Node's URL implementation reports a custom-scheme origin as "null";
  // https:// here is the test double for Chrome's extension origin string.
  const origin = "https://extension.fixture";
  globalThis.chrome = { storage: { local: area(localValues), session: area(sessionValues) }, runtime: { getURL() { return `${origin}/`; } } };
  return { api: await load("src/background/vault/system-auth.ts"), localValues, sessionValues, origin, restore() { globalThis.chrome = originalChrome; } };
}

async function registerFixture(harness) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  harness.pair = pair;
  const pending = await harness.api.beginSystemAuthenticator("register");
  const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: pending.challenge, origin: harness.origin }));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  await harness.api.saveSystemAuthenticator({
    credentialId: "fixture-credential",
    clientDataJSON: base64Url(clientData),
    authenticatorData: base64Url(await authenticatorDataFor(harness.origin, 0x05)),
    publicKey: base64Url(publicKey),
    algorithm: -7,
  });
}

async function assertionFixture(harness, challenge) {
  const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge, origin: harness.origin }));
  const authenticatorData = await authenticatorDataFor(harness.origin, 0x05);
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData));
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData); signedData.set(clientDataHash, authenticatorData.length);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, harness.pair.privateKey, signedData));
  return { credentialId: "fixture-credential", clientDataJSON: base64Url(clientData), authenticatorData: base64Url(authenticatorData), signature: base64Url(signature) };
}

function authenticatorDataFor(origin, flags, rpId = origin) {
  const data = new Uint8Array(37);
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)).then((hash) => { data.set(new Uint8Array(hash)); data[32] = flags; return data; });
}

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Buffer.from(binary, "binary").toString("base64url");
}
