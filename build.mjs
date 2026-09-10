import { cp, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { assertReleaseArtifact } from "./scripts/release-artifact-check.mjs";
import { buildCredentialCore } from "./scripts/build-wasm.mjs";

const root = resolve(import.meta.dirname);
export async function buildExtension({
  outDirectory = resolve(root, "dist"),
  seed = "stable-v1",
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
  ]) {
    await cp(resolve(root, source), resolve(out, target));
  }

  const { mkdir } = await import("node:fs/promises");
  await mkdir(resolve(out, "icons"), { recursive: true });
  for (const icon of ["icon16.png", "icon48.png", "icon128.png"]) {
    await cp(resolve(root, "public/icons", icon), resolve(out, "icons", icon));
  }

  await audit(out);
  console.log(`Built extension into ${out}`);
  return { out, rawWasm, finalWasm, wasmTool };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await buildExtension();
}
