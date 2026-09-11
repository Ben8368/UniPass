import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { assertReleaseArtifact, EXPECTED_ARTIFACT_FILES } from "./scripts/release-artifact-check.mjs";
import { buildCredentialCore } from "./scripts/build-wasm.mjs";

const root = resolve(import.meta.dirname);

export function formatBuildTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export async function buildExtension({
  outDirectory = resolve(root, "dist"),
  seed = "stable-v1",
  buildTime = formatBuildTime(new Date()),
  wasmPostProcess,
  audit = assertReleaseArtifact,
} = {}) {
  const out = resolve(outDirectory);
  await rm(out, { recursive: true, force: true });
  const wasmPath = resolve(out, "credential-core.wasm");
  await buildCredentialCore(wasmPath, { seed });
  const rawWasm = await readFile(wasmPath);
  const wasmTool = wasmPostProcess ? await wasmPostProcess(wasmPath) : { available: false, command: null, flags: [] };
  const finalWasm = await readFile(wasmPath);

  await build({
    absWorkingDir: root,
    entryPoints: {
      "background/service-worker": "src/background/service-worker.ts",
      "content/content-script": "src/content/content-script.ts",
      "content/page-overlay": "src/content/page-overlay.ts",
      popup: "src/popup/popup.ts",
      manage: "src/manage/manage.ts",
    },
    bundle: true,
    format: "esm",
    outdir: out,
    platform: "browser",
    target: "chrome120",
    minify: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    sourcemap: false,
    treeShaking: true,
    drop: ["debugger"],
    legalComments: "eof",
    logLevel: "info",
    loader: { ".html": "text", ".css": "text" },
  });

  for (const [source, target] of [
    ["src/popup/popup.html", "popup.html"],
    ...["popup.css", "components.css", "theme.css", "liquid-glass.css"].map((file) => [`src/popup/${file}`, file]),
    ["public/manifest.json", "manifest.json"],
    ["src/manage/manage.html", "manage.html"],
    ["src/manage/manage.css", "manage.css"],
  ]) {
    await cp(resolve(root, source), resolve(out, target));
  }

  const manifest = JSON.parse(await readFile(resolve(out, "manifest.json"), "utf8"));
  manifest.version_name = `build-${buildTime}`;
  await writeFile(resolve(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const storeBaselineVersion = await readStoreBaselineVersion();
  await writeFile(resolve(out, "runtime-config.json"), `${JSON.stringify({
    version: 1,
    networkPluginVersion: storeBaselineVersion,
  }, null, 2)}\n`);
  await writeFile(resolve(out, "self-build-files.json"), `${JSON.stringify({
    version: 1,
    files: [...EXPECTED_ARTIFACT_FILES].sort(),
  }, null, 2)}\n`);

  await mkdir(resolve(out, "icons"), { recursive: true });
  for (const icon of ["icon16.png", "icon48.png", "icon128.png"]) {
    await cp(resolve(root, "public/icons", icon), resolve(out, "icons", icon));
  }

  await audit(out);
  console.log(`Built extension into ${out}`);
  return { out, rawWasm, finalWasm, wasmTool };
}

async function readStoreBaselineVersion() {
  const source = await readFile(resolve(root, "src/shared/plugin-version.ts"), "utf8");
  const match = source.match(/STORE_PLUGIN_VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/);
  if (!match) throw new Error("无法读取 STORE_PLUGIN_VERSION");
  return match[1];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await buildExtension();
}
