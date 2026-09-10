import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export const root = resolve(import.meta.dirname, "..");

function normalizeForRust(path) {
  return resolve(path).replaceAll("\\", "/");
}

export function rustEnvironment(env = process.env) {
  const remapFlags = [
    `--remap-path-prefix=${normalizeForRust(root)}=/s`,
    `--remap-path-prefix=${normalizeForRust(resolve(homedir(), ".cargo/registry/src"))}=/r`,
    `--remap-path-prefix=${normalizeForRust(resolve(homedir(), ".rustup/toolchains"))}=/t`,
    "--remap-path-prefix=/rustc=/t",
    "--remap-path-prefix=/rust/deps=/d",
    "-C debuginfo=0",
  ];
  const existing = env.RUSTFLAGS?.trim();
  return {
    ...env,
    RUSTFLAGS: [existing, ...remapFlags].filter(Boolean).join(" "),
  };
}

export async function resolveCargo() {
  const rustup = process.platform === "win32"
    ? resolve(homedir(), ".cargo/bin/rustup.exe")
    : "rustup";
  const toolchainCandidates = process.platform === "win32"
    ? ["1.98.1-x86_64-pc-windows-gnu", "1.98.1"]
    : ["1.98.1"];
  for (const toolchain of toolchainCandidates) {
    try {
      await runProcess(rustup, ["run", toolchain, "cargo", "--version"], { quiet: true });
      return { command: rustup, prefix: ["run", toolchain, "cargo"] };
    } catch {
      // Try the host-specific toolchain fallback.
    }
  }
  {
    const candidates = process.platform === "win32"
      ? ["cargo", resolve(homedir(), ".cargo/bin/cargo.exe")]
      : ["cargo"];
    for (const candidate of candidates) {
      try {
        await runProcess(candidate, ["--version"], { quiet: true });
        return { command: candidate, prefix: [] };
      } catch {
        // Continue to the next local installation.
      }
    }
  }
  throw new Error("缺少 Rust 1.98.1 与 wasm32-unknown-unknown target，无法执行 credential core QA");
}

export async function runCargo(args, { env = process.env, quiet = false } = {}) {
  const cargo = await resolveCargo();
  return runProcess(cargo.command, [...cargo.prefix, ...args], { env: rustEnvironment(env), quiet });
}

export async function runProcess(command, args, { env = process.env, quiet = false, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      shell: false,
      stdio: quiet ? "ignore" : [input == null ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    if (input != null) {
      child.stdin.end(input);
    }
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} 失败，退出码 ${code}`));
    });
  });
}
