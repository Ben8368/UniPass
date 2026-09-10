import { access, cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCargo } from "./rust-command.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = resolve(root, "credential-core/Cargo.toml");
export const credentialCoreArtifact = resolve(
  root,
  "credential-core/target/wasm32-unknown-unknown/release/credential_core.wasm",
);

export async function buildCredentialCore(destination, { seed = "stable-v1", targetDirectory } = {}) {
  const env = {
    ...process.env,
    UNIPASS_HARDEN_SEED: seed,
    ...(targetDirectory ? { CARGO_TARGET_DIR: targetDirectory } : {}),
  };
  await runCargo([
    "build",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--manifest-path",
    manifest,
  ], { env });
  const artifact = targetDirectory
    ? resolve(targetDirectory, "wasm32-unknown-unknown/release/credential_core.wasm")
    : credentialCoreArtifact;
  if (destination) {
    await mkdir(dirname(destination), { recursive: true });
    await cp(artifact, destination);
  }
  return artifact;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await buildCredentialCore();
  await access(credentialCoreArtifact);
  console.log(`Built credential core into ${credentialCoreArtifact}`);
}
