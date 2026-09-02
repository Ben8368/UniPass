import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TARGET_EXTENSION_ID = "gjphikebcceegfolnbfncepfmjnhdkam";
const STORE_VERSION = [5, 3, 0];

function extensionIdFromPublicKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...digest].map((nibble) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16))).join("");
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  for (let index = 0; index < right.length; index += 1) {
    if (leftParts[index] !== right[index]) return leftParts[index] - right[index];
  }
  return 0;
}

test("local manifest keeps the store extension ID and a higher version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));

  assert.equal(extensionIdFromPublicKey(manifest.key), TARGET_EXTENSION_ID);
  assert.ok(compareVersions(manifest.version, STORE_VERSION) > 0, "本地 manifest 版本必须高于商店版 5.3.0");
});
