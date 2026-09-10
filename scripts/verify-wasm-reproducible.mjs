import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCargo } from "./rust-command.mjs";

const targetRoot = await mkdtemp(join(tmpdir(), "unipass-wasm-repro-"));
const buildArgs = [
  "build",
  "--locked",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
  "--manifest-path",
  "credential-core/Cargo.toml",
];

try {
  const hashes = [];
  for (const label of ["a", "b"]) {
    const targetDirectory = join(targetRoot, `target-${label}`);
    await runCargo(buildArgs, {
      env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
    });
    const artifact = resolve(targetDirectory, "wasm32-unknown-unknown/release/credential_core.wasm");
    const bytes = await readFile(artifact);
    const hash = createHash("sha256").update(bytes).digest("hex");
    hashes.push(hash);
    console.log(`SHA256 #${hashes.length}: ${hash}`);
  }

  if (hashes[0] !== hashes[1]) {
    throw new Error(`🚦 WASM reproducibility: RED\n🔴 两次独立构建 hash 不一致：${hashes[0]} != ${hashes[1]}`);
  }
  console.log("🚦 WASM reproducibility: GREEN");
} finally {
  await rm(targetRoot, { recursive: true, force: true });
}
