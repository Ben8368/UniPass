import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { assertReleaseArtifact } from "./scripts/release-artifact-check.mjs";

const root = resolve(import.meta.dirname);
const out = resolve(root, "dist");

await rm(out, { recursive: true, force: true });
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

await assertReleaseArtifact(out);
console.log(`Built extension into ${out}`);
