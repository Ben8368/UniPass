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
