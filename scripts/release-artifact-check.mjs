import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { inspectWasm } from "./wasm-inspect.mjs";

export const EXPECTED_ARTIFACT_FILES = Object.freeze([
  "background/service-worker.js",
  "components.css",
  "credential-core.wasm",
  "content/content-script.js",
  "content/page-overlay.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "liquid-glass.css",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  "theme.css",
]);
export const EXPECTED_WASM_IMPORTS = Object.freeze([]);
export const EXPECTED_WASM_EXPORTS = Object.freeze(["memory", "c_a", "c_f", "c_u", "c_v", "c_k"]);
export const HARDENED_ARTIFACT_FILES = Object.freeze(["integrity.json", "hardened-build-report.json"]);

const EXPECTED_DIRECTORIES = new Set(["background", "content", "icons"]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json"]);
const SOURCE_EXTENSIONS = new Set([".jsx", ".map", ".ts", ".tsx"]);
const FORBIDDEN_TEXT = [
  ["source map/source URL 指令", /(?:\/\/[#@]|\/\*[#@])\s*source(?:Mapping)?URL\s*=/i],
  ["debugger 语句", /\bdebugger\s*;/],
  ["PEM 私钥", /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub access token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["OpenAI API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
];
const FORBIDDEN_JS_TEXT = [
  ["UniPass 固定解密材料（Base64）", /VlXCSJg7qO66MNrMMJir3g==/],
  ["UniPass 固定解密材料（hex）", /5655c248983ba8eeba30dacc3098abde/i],
  ["CryptoJS AES 特征", /CryptoJS\.AES/],
  ["CryptoJS DES 特征", /CryptoJS\.DES/],
  ["CryptoJS MD5 特征", /CryptoJS\.MD5/],
  ["CryptoJS 运行时", /\bCryptoJS\b/],
  ["Jupiter 固定密码协议材料", /phoenix_toptou/],
];
const FORBIDDEN_WASM_TEXT = [
  ["UniPass 固定解密材料（Base64）", Buffer.from("VlXCSJg7qO66MNrMMJir3g==")],
  ["UniPass 固定解密材料（hex）", Buffer.from("5655c248983ba8eeba30dacc3098abde", "utf8")],
  ["Jupiter 固定密码协议材料", Buffer.from("phoenix_toptou")],
];
const FORBIDDEN_WASM_BYTES = [
  ["UniPass 完整 raw AES key", Buffer.from("5655c248983ba8eeba30dacc3098abde", "hex")],
];

export async function inspectReleaseArtifact(directory, { additionalFiles = [] } = {}) {
  const root = resolve(directory);
  const errors = [];
  let entries;
  try {
    entries = await collectEntries(root);
  } catch (error) {
    return [`无法读取产物目录 ${root}：${error instanceof Error ? error.message : String(error)}`];
  }

  for (const directoryName of entries.directories) {
    if (!EXPECTED_DIRECTORIES.has(directoryName)) errors.push(`出现未审计目录：${directoryName}`);
  }
  for (const specialEntry of entries.specialEntries) {
    errors.push(`产物不得包含符号链接或特殊文件：${specialEntry}`);
  }

  const actualFiles = new Set(entries.files);
  const expectedFiles = new Set([...EXPECTED_ARTIFACT_FILES, ...additionalFiles]);
  for (const file of expectedFiles) {
    if (!actualFiles.has(file)) errors.push(`缺少预期产物：${file}`);
  }
  for (const file of actualFiles) {
    if (!expectedFiles.has(file)) errors.push(`出现未审计文件：${file}`);
    if (SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) errors.push(`产物包含源码或 source map：${file}`);
  }

  for (const file of entries.files) {
    const extension = extname(file).toLowerCase();
    if (file === "credential-core.wasm") {
      const wasmErrors = await inspectCredentialCore(resolve(root, ...file.split("/")));
      errors.push(...wasmErrors.map((error) => `credential-core.wasm ${error}`));
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const content = await readFile(resolve(root, ...file.split("/")), "utf8");
    for (const [label, pattern] of FORBIDDEN_TEXT) {
      if (pattern.test(content)) errors.push(`${file} 包含${label}`);
    }
    if (extension === ".js") {
      for (const [label, pattern] of FORBIDDEN_JS_TEXT) {
        if (pattern.test(content)) errors.push(`${file} 包含${label}`);
      }
      try {
        const minified = await transform(content, {
          loader: "js",
          target: "chrome120",
          minify: true,
          legalComments: "eof",
        });
        const originalBytes = Buffer.byteLength(content);
        const minifiedBytes = Buffer.byteLength(minified.code);
        if (originalBytes && minifiedBytes < originalBytes * 0.9) {
          errors.push(`${file} 仍可被标准压缩显著缩小`);
        }
      } catch (error) {
        errors.push(`${file} 不是可解析的 JavaScript：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return [...new Set(errors)];
}

export async function inspectHardenedArtifact(directory) {
  const root = resolve(directory);
  const errors = await inspectReleaseArtifact(root, { additionalFiles: HARDENED_ARTIFACT_FILES });
  try {
    const integrity = JSON.parse(await readFile(resolve(root, "integrity.json"), "utf8"));
    const expected = new Set([
      "credential-core.wasm",
      "background/service-worker.js",
      "content/content-script.js",
      "popup.js",
    ]);
    const actual = new Set(Object.keys(integrity.files ?? {}));
    if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
      errors.push("integrity.json 文件集合不符合白名单");
    }
    for (const file of expected) {
      const expectedHash = integrity.files?.[file];
      const bytes = await readFile(resolve(root, ...file.split("/")));
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (expectedHash !== actualHash) errors.push(`integrity.json 与 ${file} 不匹配`);
    }
  } catch (error) {
    errors.push(`integrity.json 无效：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const report = JSON.parse(await readFile(resolve(root, "hardened-build-report.json"), "utf8"));
    if (!/^[a-f0-9]{64}$/.test(report.hardenSeedSha256 ?? "")) errors.push("hardened report 缺少 seed hash");
    if ("seed" in report || "fragments" in report || "password" in report || "key" in report) {
      errors.push("hardened report 不得包含 seed、fragment、password 或 key");
    }
  } catch (error) {
    errors.push(`hardened-build-report.json 无效：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const wasm = await readFile(resolve(root, "credential-core.wasm"));
    const inspection = inspectWasm(wasm);
    for (const hit of inspection.forbiddenHits) errors.push(`包含禁止的 WASM 路径特征：${hit}`);
  } catch (error) {
    errors.push(`无法完成 hardened WASM 路径审计：${error instanceof Error ? error.message : String(error)}`);
  }
  return [...new Set(errors)];
}

async function inspectCredentialCore(path) {
  const bytes = await readFile(path);
  const errors = [];
  const magic = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
  const version = Buffer.from([0x01, 0x00, 0x00, 0x00]);
  if (bytes.length < 8 || !bytes.subarray(0, 4).equals(magic)) errors.push("格式 magic 错误");
  if (bytes.length < 8 || !bytes.subarray(4, 8).equals(version)) errors.push("格式 version 错误");
  for (const [label, forbidden] of FORBIDDEN_WASM_TEXT) {
    if (bytes.includes(forbidden)) errors.push(`包含${label}`);
  }
  for (const [label, forbidden] of FORBIDDEN_WASM_BYTES) {
    if (bytes.includes(forbidden)) errors.push(`包含${label}`);
  }
  try {
    const module = new WebAssembly.Module(bytes);
    for (const sectionName of ["name", "producers"]) {
      if (WebAssembly.Module.customSections(module, sectionName).length) {
        errors.push(`包含不应发布的 ${sectionName} custom section`);
      }
    }
    const imports = WebAssembly.Module.imports(module).map(({ module: source, name }) => `${source}.${name}`).sort();
    const exports = WebAssembly.Module.exports(module).map(({ name }) => name).sort();
    if (JSON.stringify(imports) !== JSON.stringify([...EXPECTED_WASM_IMPORTS].sort())) {
      errors.push(`imports 不符合白名单：${imports.join(", ") || "<none>"}`);
    }
    if (JSON.stringify(exports) !== JSON.stringify([...EXPECTED_WASM_EXPORTS].sort())) {
      errors.push(`exports 不符合白名单：${exports.join(", ") || "<none>"}`);
    }
  } catch (error) {
    errors.push(`无法实例化 WebAssembly.Module：${error instanceof Error ? error.message : String(error)}`);
  }
  return errors;
}

export async function assertReleaseArtifact(directory) {
  const errors = await inspectReleaseArtifact(directory);
  if (errors.length) {
    throw new Error(`🚦 Release Artifact Audit: RED\n${errors.map((error) => `🔴 ${error}`).join("\n")}`);
  }
  console.log("🚦 Release Artifact Audit: GREEN");
}

export async function assertHardenedArtifact(directory) {
  const errors = await inspectHardenedArtifact(directory);
  if (errors.length) {
    throw new Error(`🚦 Hardened Artifact Audit: RED\n${errors.map((error) => `🔴 ${error}`).join("\n")}`);
  }
  console.log("🚦 Hardened Artifact Audit: GREEN");
}

async function collectEntries(root) {
  const files = [];
  const directories = [];
  const specialEntries = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const label = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        directories.push(label);
        await visit(path);
      } else if (entry.isFile()) {
        files.push(label);
      } else {
        specialEntries.push(label);
      }
    }
  }

  await visit(root);
  return {
    directories: directories.sort(),
    files: files.sort(),
    specialEntries: specialEntries.sort(),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await assertReleaseArtifact(process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
