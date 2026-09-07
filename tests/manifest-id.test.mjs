import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TARGET_EXTENSION_ID = "gjphikebcceegfolnbfncepfmjnhdkam";

function extensionIdFromPublicKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...digest].map((nibble) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16))).join("");
}


test("local manifest keeps the store extension ID and a release version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));

  assert.equal(extensionIdFromPublicKey(manifest.key), TARGET_EXTENSION_ID);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "manifest 版本必须为三段整数；与商店的动态关系由 audit:static 核验");
  assert.deepEqual(manifest.host_permissions, [
    "https://portal.unipass.top/*",
    "https://accounts.feishu.cn/*",
    "https://jupiter.tec-do.com/*",
  ]);
});
