import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/background/jupiter-keepalive.ts", import.meta.url), "utf8");

test("Jupiter keepalive renews through a background login POST", () => {
  assert.match(source, /method: "POST"/);
  assert.match(source, /JUPITER_LOGIN_URL/);
  assert.match(source, /isRemember: 1/);
  assert.match(source, /Keepalive is a background login renewal/);
});

test("Jupiter keepalive never reloads or navigates the active page", () => {
  assert.doesNotMatch(source, /location\.reload\s*\(/);
  assert.doesNotMatch(source, /chrome\.tabs\.update\s*\(/);
  assert.doesNotMatch(source, /new StorageEvent\("storage"/);
  assert.match(source, /Do not dispatch a storage event/);
});

test("Jupiter keepalive rechecks settings before applying a renewal", () => {
  assert.match(source, /const latestSettings = await readStoredJupiterKeepaliveSettings\(\)/);
  assert.match(source, /if \(!latestSettings\.enabled \|\| latestSettings\.userScope !== settings\.userScope\) return/);
});

test("keepalive does not restore an enabled state after it was disabled mid-request", () => {
  assert.match(source, /const latestSettings = await readStoredJupiterKeepaliveSettings\(\)[\s\S]*?if \(latestSettings\.enabled && latestSettings\.userScope === settings\.userScope\)/);
});

test("Jupiter keepalive requests the combined ciphertext transform", () => {
  assert.match(source, /jupiterCredentialForAccount/);
  assert.doesNotMatch(source, /credentialForAccount/);
  assert.doesNotMatch(source, /transformJupiterPassword/);
  assert.doesNotMatch(source, /credential\.password/);
  assert.match(source, /transformedPassword/);
});

test("Jupiter transformed credentials are cleared in the Service Worker finally path", () => {
  assert.match(source, /credential\.username\s*=\s*""/);
  assert.match(source, /credential\.transformedPassword\s*=\s*""/);
  assert.match(source, /credential\s*=\s*undefined/);
});

test("disabling keepalive waits for active tab syncs and syncs recheck enabled state", () => {
  assert.match(source, /const activeSessionSyncs = new Set<Promise<void>>\(\)/);
  assert.match(source, /if \(!settings\.enabled \|\| settings\.userScope !== loginData\.userScope\) return/);
  assert.match(source, /await waitForActiveSessionSyncs\(\)/);
});

test("Jupiter login responses validate and minimize session data", () => {
  assert.match(source, /typeof accessToken !== "string"/);
  assert.match(source, /accessToken, userInfo/);
  assert.match(source, /sanitizeJupiterUserInfo/);
  assert.doesNotMatch(source, /\{\.\.\.loginData, userScope\}/);
});

test("keepalive mutations use a generation guard to avoid stale disable cleanup", () => {
  assert.match(source, /let keepaliveGeneration = 0/);
  assert.match(source, /const operationGeneration = \+\+keepaliveGeneration/);
  assert.match(source, /if \(generation !== keepaliveGeneration\) return/);
});
