import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import {
  EXPECTED_ARTIFACT_FILES,
  inspectReleaseArtifact,
} from "../scripts/release-artifact-check.mjs";

async function artifactFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "unipass-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of EXPECTED_ARTIFACT_FILES) {
    const path = join(root, ...file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    const extension = extname(file);
    const content = extension === ".js"
      ? "globalThis.__artifactFixture=1;\n"
      : extension === ".json"
        ? "{}\n"
        : extension === ".png"
          ? Buffer.from([0x89, 0x50, 0x4e, 0x47])
          : "body{}\n";
    await writeFile(path, content);
  }
  return root;
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
