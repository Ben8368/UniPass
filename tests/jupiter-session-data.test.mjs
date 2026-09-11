import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const buildResult = await build({
  entryPoints: [fileURLToPath(new URL("../src/background/jupiter-session-data.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString("base64")}`;
const { sanitizeJupiterUserInfo } = await import(moduleUrl);

test("Jupiter user info recursively drops sensitive fields before session sync", () => {
  const sanitized = sanitizeJupiterUserInfo({
    displayName: "Tester",
    accessToken: "top-level-secret",
    nested: {
      theme: "dark",
      password: "nested-secret",
      profile: { avatar: "avatar-url", refreshToken: "nested-token" },
    },
    records: [{ label: "safe", authorizationCode: "nested-code" }],
  });

  assert.deepEqual(sanitized, {
    displayName: "Tester",
    nested: { theme: "dark", profile: { avatar: "avatar-url" } },
    records: [{ label: "safe" }],
  });
});
