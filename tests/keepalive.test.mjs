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
