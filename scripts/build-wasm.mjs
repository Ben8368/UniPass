import { access, cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifest = resolve(root, "credential-core/Cargo.toml");
export const credentialCoreArtifact = resolve(
  root,
  "credential-core/target/wasm32-unknown-unknown/release/credential_core.wasm",
);

export async function buildCredentialCore(destination) {
  const cargo = await resolveCargo();
  await run(cargo.command, [
    ...cargo.prefix,
    "build",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--manifest-path",
    manifest,
  ], false, cargo.env);
  if (destination) {
    await mkdir(dirname(destination), { recursive: true });
    await cp(credentialCoreArtifact, destination);
  }
  return credentialCoreArtifact;
}

async function resolveCargo() {
  const candidates = process.platform === "win32"
    ? ["cargo", resolve(homedir(), ".cargo/bin/cargo.exe")]
    : ["cargo"];
  for (const candidate of candidates) {
    try {
      await run(candidate, ["--version"], true);
      if (process.platform === "win32" && !process.env.RUSTUP_TOOLCHAIN) {
        const rustup = resolve(homedir(), ".cargo/bin/rustup.exe");
        try {
          const toolchains = await output(rustup, ["toolchain", "list"]);
          const gnu = toolchains.match(/1\.85\.1-x86_64-pc-windows-gnu/);
          if (gnu) {
            return {
              command: rustup,
              prefix: ["run", gnu[0], "cargo"],
              env: process.env,
            };
          }
        } catch {
          // The default Rust host works when the matching native linker is installed.
        }
      }
      return { command: candidate, prefix: [], env: process.env };
    } catch {
      // Try the next local toolchain location.
    }
  }
  throw new Error("缺少 Rust 1.85.1 与 wasm32-unknown-unknown target，无法构建 credential core");
}

function run(command, args, quiet = false, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: quiet ? "ignore" : "inherit",
      shell: false,
      env,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} 失败，退出码 ${code}`));
    });
  });
}

function output(command, args) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    const child = spawn(command, args, { cwd: root, shell: false });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} ${args.join(" ")} 失败，退出码 ${code}`));
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await buildCredentialCore();
  await access(credentialCoreArtifact);
  console.log(`Built credential core into ${credentialCoreArtifact}`);
}
