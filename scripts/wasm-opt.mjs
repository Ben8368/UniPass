import { copyFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function probe(command, args) {
  try {
    const result = await execFileAsync(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 });
    return `${result.stdout}\n${result.stderr}`;
  } catch {
    return null;
  }
}

async function resolveWasmOpt() {
  const candidates = process.env.WASM_OPT
    ? [process.env.WASM_OPT]
    : process.platform === "win32" ? ["wasm-opt.exe", "wasm-opt"] : ["wasm-opt"];
  for (const command of candidates) {
    const help = await probe(command, ["--help"]);
    if (help) return { command, help };
  }
  return null;
}

export async function optimizeWasm(path) {
  const binary = await resolveWasmOpt();
  if (!binary) {
    return { available: false, command: null, flags: [] };
  }

  const supported = (flag) => binary.help.includes(flag);
  const flags = ["-Oz", "--strip-debug", "--strip-producers", "--vacuum"].filter(supported);
  if (!flags.includes("-Oz")) {
    throw new Error("wasm-opt 可用但不支持 -Oz，拒绝猜测或降级参数");
  }
  const optimized = `${path}.optimized`;
  try {
    await execFileAsync(binary.command, [...flags, path, "-o", optimized], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    await copyFile(optimized, path);
  } finally {
    await rm(optimized, { force: true });
  }
  return { available: true, command: binary.command, flags };
}
