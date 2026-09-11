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
    loader: { ".json": "json" },
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { SaveGestureStateMachine } = await loadModule("../src/popup/save-gesture.ts");
const { AdvancedModeUnlock } = await loadModule("../src/popup/advanced-mode.ts");
const { CHROME_VERSION_COMPONENT_MAX, assertLocalNetworkPair, compareVersions, deriveNetworkVersion, parseVersion } = await loadModule("../src/shared/version.ts");
const builder = await loadModule("../src/popup/self-builder.ts");

function fakeTimers() {
  const callbacks = [];
  const delays = [];
  return {
    schedule(callback, delay) {
      callbacks.push(callback);
      delays.push(delay);
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
    get delays() {
      return delays.slice();
    },
  };
}

test("save gesture uses one fixed window for one/two clicks and triple-click build", () => {
  const timers = fakeTimers();
  let time = 0;
  let saves = 0;
  let builds = 0;
  const gesture = new SaveGestureStateMachine(
    () => { saves += 1; },
    () => { builds += 1; },
    1400,
    timers.schedule,
    timers.cancel,
    () => time,
  );

  gesture.click();
  time = 300;
  gesture.click();
  assert.deepEqual(timers.delays, [1400]);
  time = 800;
  gesture.click();
  assert.equal(builds, 1);
  assert.equal(saves, 0);
  assert.equal(timers.pending, 0);

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
  assert.equal(builds, 2);
  assert.equal(saves, 2);
  gesture.click();
  assert.equal(builds, 2);
  timers.runNext();
  assert.equal(builds, 2);
});

test("clicks after the fixed deadline start a new round and never build", () => {
  const timers = fakeTimers();
  let time = 0;
  let saves = 0;
  let builds = 0;
  const gesture = new SaveGestureStateMachine(() => { saves += 1; }, () => { builds += 1; }, 1400, timers.schedule, timers.cancel, () => time);
  gesture.click();
  time = 1300;
  gesture.click();
  time = 2600;
  gesture.click();
  assert.equal(builds, 0);
  assert.equal(saves, 1);
  timers.runNext();
  assert.equal(saves, 2);
});

test("flushPendingSave saves one pending single or double click and never flushes a build", () => {
  const timers = fakeTimers();
  let saves = 0;
  let builds = 0;
  const gesture = new SaveGestureStateMachine(() => { saves += 1; }, () => { builds += 1; }, 1400, timers.schedule, timers.cancel, () => 0);

  gesture.click();
  gesture.flushPendingSave();
  gesture.flushPendingSave();
  assert.equal(saves, 1);

  gesture.click();
  gesture.click();
  gesture.flushPendingSave();
  assert.equal(saves, 2);

  gesture.click();
  gesture.click();
  gesture.click();
  gesture.flushPendingSave();
  assert.equal(builds, 1);
  assert.equal(saves, 2);
});

test("advanced mode requires restore default followed by two saves in the same window", () => {
  let time = 0;
  const unlock = new AdvancedModeUnlock(1400, () => time);

  assert.equal(unlock.recordSaveClick(), false);
  unlock.markRestoreDefault();
  assert.equal(unlock.recordSaveClick(), false);
  time = 900;
  assert.equal(unlock.recordSaveClick(), true);
  assert.equal(unlock.isUnlockReady, true);
  assert.equal(unlock.enter(), true);
  assert.equal(unlock.isEntered, true);
  unlock.reset();
  assert.equal(unlock.isEntered, false);
  assert.equal(unlock.isUnlockReady, false);
});

test("advanced mode does not unlock after the restore-default window expires", () => {
  let time = 0;
  const unlock = new AdvancedModeUnlock(1400, () => time);

  unlock.markRestoreDefault();
  time = 1401;
  assert.equal(unlock.recordSaveClick(), false);
  assert.equal(unlock.isUnlockReady, false);
});

test("version derivation and comparison use three integer segments", () => {
  assert.equal(CHROME_VERSION_COMPONENT_MAX, 65535);
  for (const version of ["0.0.1", "5.4.4", "5.4.65535", "65535.65535.65535"]) {
    assert.deepEqual(parseVersion(version), version.split(".").map(Number));
  }
  for (const version of ["5.4.65536", "65536.0.1", "1.65536.1", "999999999999.1.1", "-1.2.3"]) {
    assert.equal(parseVersion(version), null, version);
  }
  assert.equal(deriveNetworkVersion("5.3.4"), "5.3.3");
  assert.equal(deriveNetworkVersion("5.4.4"), "5.4.3");
  assert.equal(deriveNetworkVersion("5.4.65535"), "5.4.65534");
  assert.equal(deriveNetworkVersion("6.0.1"), "6.0.0");
  assert.equal(compareVersions("5.10.0", "5.9.99"), 1);
  assert.equal(assertLocalNetworkPair("5.4.4", "5.4.3"), true);
  assert.equal(assertLocalNetworkPair("5.4.4", "5.3.3"), false);
  assert.throws(() => deriveNetworkVersion("5.4.0"), /patch 必须至少为 1/);
  assert.throws(() => deriveNetworkVersion("v5.3.4"), /目标版本格式无效/);
});

test("self-build and release artifact checks use the same runtime file source", async () => {
  const { EXPECTED_ARTIFACT_FILES } = await import("../scripts/release-artifact-check.mjs");
  const { SELF_BUILD_STATIC_FILES } = await loadModule("../src/shared/self-build-files.ts");
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

test("self builder fails closed when self-build-files.json is missing", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { runtime: {
    getManifest: () => ({ version: "5.3.3" }),
    sendMessage: async () => ({ ok: false, error: "无法读取 self-build-files.json" }),
  } };
  try {
    await assert.rejects(() => builder.buildSelfDerivedBuild("5.3.4"), /无法读取 self-build-files\.json/);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("derived manifest preserves every top-level field except version and version_name", () => {
  const original = {
    manifest_version: 3,
    version: "5.3.3",
    version_name: "build-old",
    key: "public-key",
    name: "UniPass",
    permissions: ["storage"],
    background: { service_worker: "background/service-worker.js", type: "module" },
    nested: { enabled: true },
  };
  const derived = { ...original, version: "5.3.4", version_name: "self-260911-0010" };
  assert.doesNotThrow(() => builder.assertDerivedManifestEquivalent(original, derived));
  assert.throws(() => builder.assertDerivedManifestEquivalent(original, { ...derived, permissions: [] }), /关键字段发生变化/);
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
