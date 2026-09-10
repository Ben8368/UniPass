export const WASM_CRYPTO_WARNING_PATTERNS = Object.freeze([
  ["aes", /aes-/i],
  ["des", /des-/i],
  ["md5", /md-5/i],
  ["cipher", /cipher-/i],
  ["ecb", /ecb-/i],
  ["rustc", /rustc/i],
  ["std", /library\/std/i],
  ["panic", /panic/i],
  ["allocator", /dlmalloc/i],
]);

export const WASM_HARDENED_FORBIDDEN_PATTERNS = Object.freeze([
  ["项目 Rust source path", /(?:^|[\0\s])src[\\/][^\\/\0]{1,160}\.rs(?:$|[^A-Za-z0-9_.-])|\/s\/src[\\/][^\\/\0]{1,160}\.rs(?:$|[^A-Za-z0-9_.-])/i],
  ["credential-core/src", /credential-core[\\/]src/i],
  ["本机绝对路径", /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\/workspaces\/|\/workspace\/)/],
]);

export function inspectWasm(bytes) {
  const module = new WebAssembly.Module(bytes);
  const printableStrings = [...Buffer.from(bytes).toString("latin1").matchAll(/[ -~]{4,}/g)].map((match) => match[0]);
  const imports = WebAssembly.Module.imports(module).map(({ module: source, name }) => `${source}.${name}`).sort();
  const exports = WebAssembly.Module.exports(module).map(({ name }) => name).sort();
  const customSections = Object.fromEntries(["name", "producers"].map((name) => [
    name,
    WebAssembly.Module.customSections(module, name).length,
  ]));
  const bytesText = Buffer.from(bytes).toString("latin1");
  const warningHits = Object.fromEntries(WASM_CRYPTO_WARNING_PATTERNS.map(([label, pattern]) => [
    label,
    printableStrings.filter((value) => pattern.test(value)).slice(0, 20),
  ]));
  const forbiddenHits = WASM_HARDENED_FORBIDDEN_PATTERNS
    .filter(([, pattern]) => pattern.test(bytesText))
    .map(([label]) => label);
  return { module, printableStrings, imports, exports, customSections, warningHits, forbiddenHits };
}
