import { runCargo } from "./rust-command.mjs";

const command = process.argv[2];
const common = ["--locked", "--manifest-path", "credential-core/Cargo.toml"];
const commands = {
  fmt: ["fmt", "--check", "--manifest-path", "credential-core/Cargo.toml"],
  test: ["test", ...common],
  clippy: ["clippy", ...common, "--all-targets", "--", "-D", "warnings"],
  "clippy:wasm": ["clippy", ...common, "--target", "wasm32-unknown-unknown", "--", "-D", "warnings"],
  build: ["build", ...common, "--release", "--target", "wasm32-unknown-unknown"],
};

if (!commands[command]) {
  throw new Error(`未知 Rust QA 命令：${command ?? "<none>"}`);
}

await runCargo(commands[command]);
