import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { unzipSync } from "fflate";
import { fileURLToPath } from "node:url";

async function loadModule(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { SaveGestureStateMachine } = await loadModule("../src/popup/save-gesture.ts");
const { assertLocalNetworkPair, compareVersions, deriveNetworkVersion } = await loadModule("../src/shared/version.ts");
const { SELF_BUILD_STATIC_FILES } = await loadModule("../src/shared/self-build-files.ts");
const builder = await loadModule("../src/popup/self-builder.ts");

function fakeTimers() {
  const callbacks = [];
  return {
    schedule(callback) {
      callbacks.push(callback);
      return callback;
    },
    cancel(timer) {
      const index = callbacks.indexOf(timer);
      if (index >= 0) callbacks.splice(index, 1);
    },
    runNext() {
      callbacks.shift()?.();
    },
    get pending() {
      return callbacks.length;
    },
  };
}

test("save gesture saves once for one or two clicks and builds once for triple click", () => {
  const timers = fakeTimers();
  let saves = 0;
  let builds = 0;
  const gesture = new SaveGestureStateMachine(
    () => { saves += 1; },
    () => { builds += 1; },
    1400,
    timers.schedule,
    timers.cancel,
  );

  gesture.click();
  timers.runNext();
  assert.equal(saves, 1);
  gesture.click();
  gesture.click();
  assert.equal(timers.pending, 1);
  timers.runNext();
  assert.equal(saves, 2);
  gesture.click();
  gesture.click();
  gesture.click();
  assert.equal(builds, 1);
  assert.equal(saves, 2);
  gesture.click();
  assert.equal(builds, 1);
  timers.runNext();
  assert.equal(builds, 1);
});

test("three clicks outside the window never become a build", () => {
  const timers = fakeTimers();
  let builds = 0;
  const gesture = new SaveGestureStateMachine(() => {}, () => { builds += 1; }, 1400, timers.schedule, timers.cancel);
  for (let index = 0; index < 3; index += 1) {
    gesture.click();
    timers.runNext();
  }
  assert.equal(builds, 0);
});

test("version derivation and comparison use three integer segments", () => {
  assert.equal(deriveNetworkVersion("5.3.4"), "5.3.3");
  assert.equal(deriveNetworkVersion("5.4.4"), "5.4.3");
  assert.equal(deriveNetworkVersion("6.0.1"), "6.0.0");
  assert.equal(compareVersions("5.10.0", "5.9.99"), 1);
  assert.equal(assertLocalNetworkPair("5.4.4", "5.4.3"), true);
  assert.equal(assertLocalNetworkPair("5.4.4", "5.3.3"), false);
  assert.throws(() => deriveNetworkVersion("5.4.0"), /patch 必须至少为 1/);
  assert.throws(() => deriveNetworkVersion("v5.3.4"), /目标版本格式无效/);
});

test("self-build fallback uses the complete fixed runtime layout", async () => {
  const { EXPECTED_ARTIFACT_FILES } = await import("../scripts/release-artifact-check.mjs");
  assert.deepEqual([...SELF_BUILD_STATIC_FILES].sort(), [...EXPECTED_ARTIFACT_FILES].sort());
});

test("self builder assembles and self-verifies a complete derived ZIP", () => {
  const files = [
    ["manifest.json", { manifest_version: 3, version: "5.3.3", version_name: "5.3.3 build-old", key: "public-key", name: "UniPass" }],
    ["runtime-config.json", { version: 1, networkPluginVersion: "5.3.2" }],
    ["self-build-files.json", { version: 1, files: ["manifest.json", "runtime-config.json", "self-build-files.json", "credential-core.wasm"] }],
    ["credential-core.wasm", Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 9])],
  ].map(([path, value]) => ({
    path,
    bytes: value instanceof Buffer ? new Uint8Array(value) : new TextEncoder().encode(`${JSON.stringify(value)}\n`),
  }));
  const fileManifest = { version: 1, files: files.map(({ path }) => path) };
  const result = builder.assembleDerivedBuild({
    files,
    fileManifest,
    currentManifest: JSON.parse(new TextDecoder().decode(files[0].bytes)),
    runtimeManifestVersion: "5.3.3",
    currentRuntimeConfig: { version: 1, networkPluginVersion: "5.3.2" },
    targetLocalVersion: "5.4.4",
    derivedBuildTime: "260911-0010",
  });
  assert.equal(result.fileName, "UniPass-5.4.4.zip");
  const entries = unzipSync(result.archive);
  assert.deepEqual(Object.keys(entries).sort(), fileManifest.files.slice().sort());
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
  assert.equal(manifest.version, "5.4.4");
  assert.equal(manifest.version_name, "self-260911-0010");
  assert.equal(JSON.parse(new TextDecoder().decode(entries["runtime-config.json"])).networkPluginVersion, "5.4.3");
  assert.deepEqual([...entries["credential-core.wasm"]], [0, 97, 115, 109, 1, 0, 0, 0, 9]);
});

test("self builder can upgrade a legacy runtime without its file manifest", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { runtime: {
    sendMessage: async (message) => ({
      ok: !message.path.endsWith("self-build-files.json"),
      error: "无法读取 self-build-files.json",
    }),
  } };
  try {
    const manifest = await builder.readSelfBuildFilesManifest();
    assert.equal(manifest.version, 1);
    assert.ok(manifest.files.includes("self-build-files.json"));
    assert.ok(manifest.files.includes("credential-core.wasm"));
    assert.equal(manifest.files.length, 16);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("self builder rejects unchanged/lower versions and extra runtime files", () => {
  assert.throws(() => builder.validateSelfBuildTarget("5.3.3", "5.3.3"), /必须高于当前本地版本/);
  assert.throws(() => builder.validateSelfBuildTarget("5.3.2", "5.3.3"), /必须高于当前本地版本/);
  assert.throws(() => builder.validateSelfBuildTarget("5.3.4.1", "5.3.3"), /目标版本格式无效/);
});

test("self builder source has no sensitive state or credential access", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/popup/self-builder.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /chrome\.storage|credentialForAccount|chrome\.cookies|Jupiter|token|password/i);
});
