import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/background/credential-availability.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { credentialAvailabilityCacheKey } = await import(moduleUrl);

test("credential availability cache keys are isolated by stable user scope", () => {
  const firstUser = credentialAvailabilityCacheKey("user:first", 7);
  const secondUser = credentialAvailabilityCacheKey("user:second", 7);

  assert.notEqual(firstUser, secondUser);
  assert.equal(firstUser, credentialAvailabilityCacheKey(" user:first ", "7"));
});
