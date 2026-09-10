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

function seedStream(seed) {
  let state = 0xcbf2_9ce4_8422_2325n;
  for (const byte of new TextEncoder().encode(seed)) {
    state = BigInt.asUintN(64, state ^ BigInt(byte));
    state = BigInt.asUintN(64, state * 0x1000_0000_01b3n);
  }
  return state || 1n;
}

function nextStream(state) {
  let value = BigInt.asUintN(64, state ^ (state << 13n));
  value = BigInt.asUintN(64, value ^ (value >> 7n));
  value = BigInt.asUintN(64, value ^ (value << 17n));
  return value;
}

export function hardenedStrategyId(seed) {
  return Number(nextStream(seedStream(seed)) % 4n);
}

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
