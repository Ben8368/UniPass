const CORE_FILE = "credential-core.wasm";
const DECRYPT_ERROR = "E_CRED_DECRYPT";
const AVAILABILITY_ERROR = "E_CRED_AVAILABILITY";
const TRANSFORM_ERROR = "E_CRED_TRANSFORM";
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const EXPECTED_EXPORTS = new Set(["memory", "c_a", "c_f", "c_u", "c_v", "c_k"]);

interface CoreExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  c_a(length: number): number;
  c_f(pointer: number, length: number): void;
  c_u(pointer: number, length: number): bigint;
  c_v(pointer: number, length: number): number;
  c_k(pointer: number, length: number): bigint;
}

let corePromise: Promise<CoreExports> | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function decryptCredentialCiphertext(ciphertext: string): Promise<string> {
  return invoke(ciphertext, "c_u", DECRYPT_ERROR);
}

export async function credentialAvailableCiphertext(ciphertext: string): Promise<boolean> {
  if (!ciphertext) throw new Error(AVAILABILITY_ERROR);
  const core = await loadCore().catch(() => {
    throw new Error(AVAILABILITY_ERROR);
  });
  const input = encoder.encode(ciphertext);
  if (!input.length || input.length > MAX_INPUT_BYTES) {
    input.fill(0);
    throw new Error(AVAILABILITY_ERROR);
  }

  const inputPointer = core.c_a(input.length);
  if (!inputPointer) {
    input.fill(0);
    throw new Error(AVAILABILITY_ERROR);
  }
  try {
    assertMemoryRange(core.memory, inputPointer, input.length);
    new Uint8Array(core.memory.buffer, inputPointer, input.length).set(input);
    const status = core.c_v(inputPointer, input.length);
    if (status === 1) return false;
    if (status === 2) return true;
    throw new Error(AVAILABILITY_ERROR);
  } catch {
    throw new Error(AVAILABILITY_ERROR);
  } finally {
    input.fill(0);
    core.c_f(inputPointer, input.length);
  }
}

export async function transformJupiterCredentialCiphertext(ciphertext: string): Promise<string> {
  return invoke(ciphertext, "c_k", TRANSFORM_ERROR);
}

async function invoke(
  value: string,
  operation: "c_u" | "c_k",
  errorCode: string,
): Promise<string> {
  if (!value) throw new Error(errorCode);
  const core = await loadCore().catch(() => {
    throw new Error(errorCode);
  });
  const input = encoder.encode(value);
  if (!input.length || input.length > MAX_INPUT_BYTES) {
    input.fill(0);
    throw new Error(errorCode);
  }
  const inputPointer = core.c_a(input.length);
  if (!inputPointer) {
    input.fill(0);
    throw new Error(errorCode);
  }

  let outputPointer = 0;
  let outputLength = 0;
  try {
    assertMemoryRange(core.memory, inputPointer, input.length);
    new Uint8Array(core.memory.buffer, inputPointer, input.length).set(input);
    const packed = core[operation](inputPointer, input.length);
    const packedPointer = packed >> 32n;
    const packedLength = packed & 0xffff_ffffn;
    if (packedPointer > 0xffff_ffffn || packedLength > BigInt(MAX_OUTPUT_BYTES)) throw new Error(errorCode);
    outputPointer = Number(packedPointer);
    outputLength = Number(packedLength);
    if (!outputPointer || !outputLength) throw new Error(errorCode);
    assertMemoryRange(core.memory, outputPointer, outputLength);
    return decoder.decode(new Uint8Array(core.memory.buffer, outputPointer, outputLength));
  } catch {
    throw new Error(errorCode);
  } finally {
    input.fill(0);
    core.c_f(inputPointer, input.length);
    if (outputPointer && outputLength) core.c_f(outputPointer, outputLength);
  }
}

function assertMemoryRange(memory: WebAssembly.Memory, pointer: number, length: number): void {
  const bytes = memory.buffer.byteLength;
  if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) || pointer <= 0 || length <= 0) {
    throw new Error("E_CRED_MEMORY");
  }
  if (pointer > bytes || length > bytes - pointer) throw new Error("E_CRED_MEMORY");
}

async function loadCore(): Promise<CoreExports> {
  corePromise ??= instantiateCore().catch((error) => {
    corePromise = undefined;
    throw error;
  });
  return corePromise;
}

async function instantiateCore(): Promise<CoreExports> {
  const response = await fetch(chrome.runtime.getURL(CORE_FILE), { cache: "no-store" });
  if (!response.ok) throw new Error("E_CORE_INIT");
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});
  const imports = WebAssembly.Module.imports(result.module);
  const moduleExports = WebAssembly.Module.exports(result.module);
  if (imports.length !== 0 || moduleExports.some(({ name }) => !EXPECTED_EXPORTS.has(name))) {
    throw new Error("E_CORE_INIT");
  }
  const exports = result.instance.exports as CoreExports;
  if (
    !(exports.memory instanceof WebAssembly.Memory)
    || typeof exports.c_a !== "function"
    || typeof exports.c_f !== "function"
    || typeof exports.c_u !== "function"
    || typeof exports.c_v !== "function"
    || typeof exports.c_k !== "function"
  ) {
    throw new Error("E_CORE_INIT");
  }
  return exports;
}
