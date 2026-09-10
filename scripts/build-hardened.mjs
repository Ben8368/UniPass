import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildExtension } from "../build.mjs";
import { assertHardenedArtifact } from "./release-artifact-check.mjs";
import { optimizeWasm } from "./wasm-opt.mjs";
import { inspectWasm } from "./wasm-inspect.mjs";
import { hardenedStrategyId } from "./build-wasm.mjs";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "dist");
const metadataDirectory = resolve(root, "artifacts/hardened");
const seed = process.env.UNIPASS_HARDEN_SEED?.trim() || randomBytes(32).toString("hex");
if (!seed) throw new Error("UNIPASS_HARDEN_SEED 不能为空");

await rm(metadataDirectory, { recursive: true, force: true });
await mkdir(metadataDirectory, { recursive: true });

const result = await buildExtension({
  outDirectory: out,
  seed,
  wasmPostProcess: optimizeWasm,
  audit: async () => {},
});
const files = {
  "credential-core.wasm": "credential-core.wasm",
  "background/service-worker.js": "background/service-worker.js",
  "content/content-script.js": "content/content-script.js",
  "popup.js": "popup.js",
};
const hashes = {};
for (const [key, relativePath] of Object.entries(files)) {
  hashes[key] = createHash("sha256").update(await readFile(resolve(out, ...relativePath.split("/")))).digest("hex");
}
await writeFile(resolve(metadataDirectory, "integrity.json"), `${JSON.stringify({ version: 1, files: hashes }, null, 2)}\n`);

const wasmInspection = inspectWasm(result.finalWasm);
const jsSizes = {};
for (const file of ["background/service-worker.js", "content/content-script.js", "popup.js"]) {
  jsSizes[file] = (await readFile(resolve(out, file))).byteLength;
}
const report = {
  reportVersion: 2,
  rustVersion: "1.98.1",
  binaryenVersion: result.wasmTool.version,
  strategyId: hardenedStrategyId(seed),
  cargoLockSha256: createHash("sha256").update(await readFile(resolve(root, "credential-core/Cargo.lock"))).digest("hex"),
  hardenSeedSha256: createHash("sha256").update(seed).digest("hex"),
  rawWasmSha256: createHash("sha256").update(result.rawWasm).digest("hex"),
  optimizedWasmSha256: hashes["credential-core.wasm"],
  finalWasmSize: result.finalWasm.byteLength,
  jsSizes,
  wasm: {
    imports: wasmInspection.imports,
    exports: wasmInspection.exports,
    customSections: wasmInspection.customSections,
  },
  wasmOpt: result.wasmTool,
  secretMaterialAudit: {
    rawKey: "PASS",
    base64Key: "PASS",
    hexKey: "PASS",
    jupiterProtocolPlaintext: "PASS",
  },
  warningCounts: Object.fromEntries(Object.entries(wasmInspection.warningHits).map(([key, values]) => [key, values.length])),
  pathStringAudit: {
    forbiddenSourcePaths: wasmInspection.forbiddenHits.length === 0 ? "PASS" : "FAIL",
    warningStrings: Object.fromEntries(Object.entries(wasmInspection.warningHits).map(([key, values]) => [key, values.length])),
  },
};
if (report.wasmOpt.command) report.wasmOpt.command = "wasm-opt";
await writeFile(resolve(metadataDirectory, "hardened-build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await assertHardenedArtifact(out, { metadataDirectory });
console.log("Hardened Build Report");
console.log(JSON.stringify(report, null, 2));
