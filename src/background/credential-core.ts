const CORE_FILE = "credential-core.wasm";
const DECRYPT_ERROR = "E_CRED_DECRYPT";
const TRANSFORM_ERROR = "E_CRED_TRANSFORM";

interface CoreExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  c_a(length: number): number;
  c_f(pointer: number, length: number): void;
  c_u(pointer: number, length: number): bigint;
  c_j(pointer: number, length: number): bigint;
}

let corePromise: Promise<CoreExports> | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function decryptCredentialCiphertext(ciphertext: string): Promise<string> {
  return invoke(ciphertext, "c_u", DECRYPT_ERROR);
}

export async function transformJupiterPassword(password: string): Promise<string> {
  return invoke(password, "c_j", TRANSFORM_ERROR);
}

async function invoke(
  value: string,
  operation: "c_u" | "c_j",
  errorCode: string,
): Promise<string> {
  if (!value) throw new Error(errorCode);
  const core = await loadCore().catch(() => {
    throw new Error(errorCode);
  });
  const input = encoder.encode(value);
  const inputPointer = core.c_a(input.length);
  if (!inputPointer) {
    input.fill(0);
    throw new Error(errorCode);
  }

  let outputPointer = 0;
  let outputLength = 0;
  try {
    new Uint8Array(core.memory.buffer, inputPointer, input.length).set(input);
    const packed = core[operation](inputPointer, input.length);
    outputPointer = Number(packed >> 32n);
    outputLength = Number(packed & 0xffff_ffffn);
    if (!outputPointer || !outputLength) throw new Error(errorCode);
    return decoder.decode(new Uint8Array(core.memory.buffer, outputPointer, outputLength));
  } catch {
    throw new Error(errorCode);
  } finally {
    input.fill(0);
    core.c_f(inputPointer, input.length);
    if (outputPointer && outputLength) core.c_f(outputPointer, outputLength);
  }
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
  const exports = result.instance.exports as CoreExports;
  if (
    !(exports.memory instanceof WebAssembly.Memory)
    || typeof exports.c_a !== "function"
    || typeof exports.c_f !== "function"
    || typeof exports.c_u !== "function"
    || typeof exports.c_j !== "function"
  ) {
    throw new Error("E_CORE_INIT");
  }
  return exports;
}

