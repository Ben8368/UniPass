import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import {
  HARDENED_METADATA_FILES,
  EXPECTED_ARTIFACT_FILES,
  inspectHardenedArtifact,
  inspectReleaseArtifact,
} from "../scripts/release-artifact-check.mjs";

async function artifactFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "unipass-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const builtWasm = await readFile(new URL("../credential-core/target/wasm32-unknown-unknown/release/credential_core.wasm", import.meta.url));
  const fixtureWasm = Buffer.from(builtWasm);
  const fixtureText = fixtureWasm.toString("latin1");
  for (const match of fixtureText.matchAll(/src[\\/][^\\/\0]{1,160}\.rs/g)) {
    fixtureWasm.fill(0x20, match.index, match.index + match[0].length);
  }
  for (const file of EXPECTED_ARTIFACT_FILES) {
    const path = join(root, ...file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    const extension = extname(file);
    const content = file === "manifest.json"
      ? JSON.stringify({ manifest_version: 3, version: "5.3.3", name: "UniPass" })
      : file === "runtime-config.json"
      ? JSON.stringify({ version: 1, networkPluginVersion: "5.3.2" })
      : file === "self-build-files.json"
        ? JSON.stringify({ version: 1, files: [...EXPECTED_ARTIFACT_FILES].sort() })
        : extension === ".js"
      ? "globalThis.__artifactFixture=1;\n"
      : extension === ".json"
        ? "{}\n"
        : extension === ".png"
          ? Buffer.from([0x89, 0x50, 0x4e, 0x47])
          : extension === ".wasm"
            ? fixtureWasm
          : "body{}\n";
    await writeFile(path, content);
  }
  return root;
}

async function hardenedArtifactFixture(t) {
  const root = await artifactFixture(t);
  const metadata = await mkdtemp(join(tmpdir(), "unipass-hardened-metadata-"));
  t.after(() => rm(metadata, { recursive: true, force: true }));
  const hashes = {};
  for (const file of ["credential-core.wasm", "background/service-worker.js", "content/content-script.js", "popup.js"]) {
    hashes[file] = createHash("sha256").update(await readFile(join(root, ...file.split("/")))).digest("hex");
  }
  await writeFile(join(metadata, "integrity.json"), JSON.stringify({ version: 1, files: hashes }));
  await writeFile(join(metadata, "hardened-build-report.json"), JSON.stringify({
    reportVersion: 2,
    hardenSeedSha256: "a".repeat(64),
    strategyId: 0,
    wasmOpt: { available: true },
    warningCounts: {},
    optimizedWasmSha256: hashes["credential-core.wasm"],
    finalWasmSize: (await readFile(join(root, "credential-core.wasm"))).byteLength,
  }));
  return { root, metadata };
}

test("accepts the exact audited artifact layout", async (t) => {
  const root = await artifactFixture(t);
  assert.deepEqual(await inspectReleaseArtifact(root), []);
});

test("rejects missing, extra, source and source-map files", async (t) => {
  const root = await artifactFixture(t);
  await unlink(join(root, "manifest.json"));
  await writeFile(join(root, "notes.txt"), "unexpected");
  await writeFile(join(root, "popup.js.map"), "{}");
  await writeFile(join(root, "content", "page-overlay.ts"), "export {};");

  const errors = await inspectReleaseArtifact(root);
  assert.ok(errors.some((error) => error.includes("缺少预期产物：manifest.json")));
  assert.ok(errors.some((error) => error.includes("出现未审计文件：notes.txt")));
  assert.ok(errors.some((error) => error.includes("产物包含源码或 source map：popup.js.map")));
  assert.ok(errors.some((error) => error.includes("产物包含源码或 source map：content/page-overlay.ts")));
});

test("rejects source directives, debugger statements, secret formats and unminified JavaScript", async (t) => {
  const root = await artifactFixture(t);
  await writeFile(join(root, "popup.js"), [
    "function leaked() {",
    "  debugger;",
    '  return "ghp_012345678901234567890123456789";',
    "}",
    "//# sourceMappingURL=popup.js.map",
  ].join("\n"));

  const errors = await inspectReleaseArtifact(root);
  assert.ok(errors.some((error) => error.includes("source map/source URL 指令")));
  assert.ok(errors.some((error) => error.includes("debugger 语句")));
  assert.ok(errors.some((error) => error.includes("GitHub access token")));
  assert.ok(errors.some((error) => error.includes("仍可被标准压缩显著缩小")));
});

test("rejects credential-core identifiers and fixed protocol material in JavaScript bundles", async (t) => {
  const root = await artifactFixture(t);
  await writeFile(join(root, "popup.js"), [
    'const key = "VlXCSJg7qO66MNrMMJir3g==";',
    "CryptoJS.AES.decrypt(ciphertext, key);",
    'const protocol = "phoenix_toptou";',
  ].join("\n"));

  const errors = await inspectReleaseArtifact(root);
  assert.ok(errors.some((error) => error.includes("固定解密材料（Base64）")));
  assert.ok(errors.some((error) => error.includes("CryptoJS AES 特征")));
  assert.ok(errors.some((error) => error.includes("Jupiter 固定密码协议材料")));
});

test("rejects malformed credential-core WASM artifacts", async (t) => {
  const root = await artifactFixture(t);
  await writeFile(join(root, "credential-core.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]));
  const errors = await inspectReleaseArtifact(root);
  assert.ok(errors.some((error) => error.includes("格式 version 错误")));
  assert.ok(errors.some((error) => error.includes("无法实例化 WebAssembly.Module")));
});

test("rejects credential-core name and producers custom sections", async (t) => {
  const root = await artifactFixture(t);
  const wasmPath = join(root, "credential-core.wasm");
  const wasm = await readFile(wasmPath);
  const customSection = (name) => Buffer.concat([
    Buffer.from([0x00, name.length + 2, name.length, ...Buffer.from(name), 0x00]),
  ]);
  await writeFile(wasmPath, Buffer.concat([wasm, customSection("name"), customSection("producers")]));
  const errors = await inspectReleaseArtifact(root);
  assert.ok(errors.some((error) => error.includes("不应发布的 name custom section")));
  assert.ok(errors.some((error) => error.includes("不应发布的 producers custom section")));
});

test("accepts hardened integrity/report files and rejects a mismatched integrity hash", async (t) => {
  assert.deepEqual([...HARDENED_METADATA_FILES].sort(), ["hardened-build-report.json", "integrity.json"]);
  const { root, metadata } = await hardenedArtifactFixture(t);
  assert.deepEqual(await inspectHardenedArtifact(root, { metadataDirectory: metadata }), []);
  await writeFile(join(metadata, "integrity.json"), JSON.stringify({
    version: 1,
    files: {
      "credential-core.wasm": "0".repeat(64),
      "background/service-worker.js": "0".repeat(64),
      "content/content-script.js": "0".repeat(64),
      "popup.js": "0".repeat(64),
    },
  }));
  const errors = await inspectHardenedArtifact(root, { metadataDirectory: metadata });
  assert.ok(errors.some((error) => error.includes("integrity.json 与 credential-core.wasm 不匹配")));
});
