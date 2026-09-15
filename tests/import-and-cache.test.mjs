import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

globalThis.crypto ??= webcrypto;

async function load(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const importer = await load("src/shared/import/normalize.ts");
const cacheApi = await load("src/background/vault/local-cache.ts");
const syncApi = await load("src/background/vault/sync-engine.ts");
const cryptoApi = await load("src/shared/vault-crypto.ts");
const coreApi = await load("src/background/vault/vault-core.ts");
const vaultService = await load("src/background/vault/vault-service.ts");

test("browser CSV supports reordered columns, quoted commas, escaped quotes, and multiline values", () => {
  const result = importer.parseBrowserPasswordCsv('password,extra,username,url,name\r\n"pa,ss",ignored,user@example.com,https://example.com/login,"Example, Work"\r\n"line1\nline2",ignored,u2,https://second.example,Second');
  assert.equal(result.invalid, 0);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].password, "pa,ss");
  assert.equal(result.records[0].target.pathPrefix, "/login");
  assert.equal(result.records[0].target.scheme, "https");
  assert.equal(result.records[1].password, "line1\nline2");
});

test("browser CSV rejects malformed URLs but accepts HTTP only as a non-HTTP fill target", () => {
  const result = importer.parseBrowserPasswordCsv("name,url,username,password\nBad,not a url,u,p\nHTTP,http://example.com,u,p\nEmpty,https://example.com,,");
  assert.equal(result.invalid, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].target.scheme, "https");
  assert.equal(result.records[0].target.host, "example.com");
  assert.equal(result.records[1].username, "");
});

test("browser CSV accepts Chrome and Edge headers case-insensitively and rejects duplicate headers", () => {
  const result = importer.parseBrowserPasswordCsv(" NAME , PASSWORD , USERNAME , URL , unused\nExample,secret,user,https://example.com,ignored");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].name, "Example");
  assert.equal(result.records[0].username, "user");
  assert.throws(() => importer.parseBrowserPasswordCsv("url,URL,username,password\nhttps://example.com,https://other.example,u,p"), /duplicate/);
});

test("encrypted local cache exposes opaque bytes and survives offline writes", async () => {
  const store = new cacheApi.MemoryVaultCacheStore();
  const cache = new cacheApi.EncryptedVaultCache("vault-a", store);
  await cache.put("manifest", new Uint8Array([1, 2, 3]));
  const record = await cache.record("manifest");
  assert.deepEqual([...record.data], [1, 2, 3]);
  assert.equal(record.syncState, "dirty");
  assert.equal("password" in record, false);
  assert.equal("vaultKey" in record, false);
});

test("VaultCore reads cached ciphertext offline and fails closed for a wrong key or corrupted ciphertext", async () => {
  const store = new cacheApi.MemoryVaultCacheStore();
  const cache = new cacheApi.EncryptedVaultCache("vault-a", store);
  const key = await cryptoApi.generateVaultKey();
  const core = new coreApi.VaultCore("vault-a", cache, key);
  await core.initialize();
  const app = await core.createApp({ name: "Example", targets: [{ scheme: "https", host: "example.com" }] });
  const account = await core.createAccount({ appId: app.id, username: "user", password: "fixture-password" });
  assert.equal((await core.catalog()).accounts[0].username, "user");
  assert.equal((await core.credential({ vaultId: "vault-a", accountId: account.id })).password, "fixture-password");
  await assert.rejects(coreApi.VaultCore.open(cache, await cryptoApi.generateVaultKey()), /Vault/);
  const record = await cache.record(`credential_${account.credentialId}`);
  record.data[0] ^= 1;
  await store.put(record);
  await assert.rejects(core.credential({ vaultId: "vault-a", accountId: account.id }), /Vault/);
});

test("browser import adds, skips, overwrites, keeps duplicates, and reports partial failure without passwords", async () => {
  const store = new cacheApi.MemoryVaultCacheStore();
  const cache = new cacheApi.EncryptedVaultCache("vault-a", store);
  const core = new coreApi.VaultCore("vault-a", cache, await cryptoApi.generateVaultKey());
  await core.initialize();
  const initial = await vaultService.applyBrowserPasswordImport("vault-a", core, [{ url: "https://example.com", username: "user", password: "first" }], "skip");
  assert.equal(initial.added, 1);
  const skipped = await vaultService.applyBrowserPasswordImport("vault-a", core, [{ url: "https://example.com", username: "user", password: "second" }], "skip");
  assert.equal(skipped.skipped, 1);
  const overwrite = await vaultService.applyBrowserPasswordImport("vault-a", core, [{ url: "https://example.com", username: "user", password: "second" }], "overwrite");
  assert.equal(overwrite.added, 1);
  const catalog = await core.catalog();
  assert.equal((await core.credential({ vaultId: "vault-a", accountId: catalog.accounts[0].id })).password, "second");
  const kept = await vaultService.applyBrowserPasswordImport("vault-a", core, [{ url: "https://example.com", username: "user", password: "third" }], "keep");
  assert.equal(kept.added, 1);
  const failed = await vaultService.applyBrowserPasswordImport("vault-a", core, [{ url: "not-a-url", username: "user", password: "must-not-leak" }], "skip");
  assert.equal(failed.failed.length, 1);
  assert.doesNotMatch(failed.failed[0].reason, /must-not-leak/);
});

test("sync marks dirty objects clean after ETag upload and marks conflicts fail closed", async () => {
  const store = new cacheApi.MemoryVaultCacheStore();
  const cache = new cacheApi.EncryptedVaultCache("vault-a", store);
  await cache.put("app_1234567890123456", new Uint8Array([9]));
  const remote = {
    async connect() {},
    async list() { return [{ id: "app_1234567890123456", revision: '"remote"', kind: "app" }]; },
    async get() { return { id: "app_1234567890123456", revision: '"remote"', data: new Uint8Array([8]), kind: "app" }; },
    async put() { return { id: "app_1234567890123456", revision: '"new"' }; },
    async delete() {},
  };
  const sync = new syncApi.VaultSyncEngine(cache, remote);
  const uploaded = await sync.synchronize();
  assert.equal(uploaded.uploaded, 1);
  assert.equal((await cache.record("app_1234567890123456")).syncState, "clean");

  await cache.put("app_2234567890123456", new Uint8Array([7]));
  const conflictRemote = { ...remote, async list() { return [{ id: "app_2234567890123456", revision: '"changed"', kind: "app" }]; }, async put() { throw Object.assign(new Error("etag"), { code: "revision-conflict" }); } };
  const conflict = await new syncApi.VaultSyncEngine(cache, conflictRemote).synchronize();
  assert.equal(conflict.state, "conflict");
  assert.equal((await cache.record("app_2234567890123456")).syncState, "conflict");
});

test("sync pulls changed clean ciphertext but never overwrites a dirty local object", async () => {
  const store = new cacheApi.MemoryVaultCacheStore();
  const cache = new cacheApi.EncryptedVaultCache("vault-a", store);
  await cache.acceptRemote({ id: "account_1234567890123456", revision: '"old"', data: new Uint8Array([1]) });
  let remoteRevision = '"changed"';
  const remote = {
    async connect() {},
    async list() { return [{ id: "account_1234567890123456", revision: remoteRevision, kind: "account" }]; },
    async get() { return { id: "account_1234567890123456", revision: remoteRevision, data: new Uint8Array([2]), kind: "account" }; },
    async put() { throw new Error("unexpected upload"); }, async delete() {},
  };
  assert.equal(await new syncApi.VaultSyncEngine(cache, remote).pull(), 1);
  assert.deepEqual([...(await cache.record("account_1234567890123456")).data], [2]);
  await cache.put("account_1234567890123456", new Uint8Array([3]), (await cache.record("account_1234567890123456")).revision);
  remoteRevision = '"changed-again"';
  await new syncApi.VaultSyncEngine(cache, remote).pull();
  assert.equal((await cache.record("account_1234567890123456")).syncState, "conflict");
  assert.deepEqual([...(await cache.record("account_1234567890123456")).data], [3]);
});
