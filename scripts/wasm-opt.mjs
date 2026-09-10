import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
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
    if (help) return { command, help, version: await probe(command, ["--version"]) };
  }
  if (process.env.UNIPASS_ALLOW_UNOPTIMIZED_WASM === "1") {
    console.warn("Hardened build: wasm-opt not found; explicit UNIPASS_ALLOW_UNOPTIMIZED_WASM=1 permits debug fallback");
    return { command: null, help: "", version: null };
  }
  throw new Error(
    "Hardened build requires Binaryen wasm-opt; install a pinned Binaryen release or explicitly set UNIPASS_ALLOW_UNOPTIMIZED_WASM=1 for a debug fallback",
  );
}

export async function optimizeWasm(path) {
  const binary = await resolveWasmOpt();
  if (!binary.command) {
    await stripProjectRustSourcePaths(path);
    return { available: false, command: null, flags: [], version: null, explicitlyAllowed: true };
  }

  const supported = (flag) => binary.help.includes(flag);
  const flags = [
    "-Oz",
    "--enable-bulk-memory",
    "--enable-bulk-memory-opt",
    "--strip-debug",
    "--strip-producers",
    "--vacuum",
  ].filter(supported);
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
    await stripProjectRustSourcePaths(path);
  } finally {
    await rm(optimized, { force: true });
  }
  return { available: true, command: binary.command, flags, version: binary.version };
}

async function stripProjectRustSourcePaths(path) {
  const bytes = await readFile(path);
  const text = bytes.toString("latin1");
  const pattern = /(?:^|[\0\s])src[\\/][^\\/\0]{1,160}\.rs(?:$|[^A-Za-z0-9_.-])|\/s\/src[\\/][^\\/\0]{1,160}\.rs(?:$|[^A-Za-z0-9_.-])/gi;
  const stripped = Buffer.from(bytes);
  for (const match of text.matchAll(pattern)) {
    const sourceIndex = match.index + (match[0].startsWith("src") ? 0 : match[0].indexOf("src"));
    stripped.fill(0x5f, sourceIndex, sourceIndex + 3);
  }
  if (!stripped.equals(bytes)) await writeFile(path, stripped);
}
