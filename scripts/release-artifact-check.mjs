import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

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

export async function inspectReleaseArtifact(directory) {
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
  const expectedFiles = new Set(EXPECTED_ARTIFACT_FILES);
  for (const file of EXPECTED_ARTIFACT_FILES) {
    if (!actualFiles.has(file)) errors.push(`缺少预期产物：${file}`);
  }
  for (const file of actualFiles) {
    if (!expectedFiles.has(file)) errors.push(`出现未审计文件：${file}`);
    if (SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) errors.push(`产物包含源码或 source map：${file}`);
  }

  for (const file of entries.files) {
    const extension = extname(file).toLowerCase();
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

export async function assertReleaseArtifact(directory) {
  const errors = await inspectReleaseArtifact(directory);
  if (errors.length) {
    throw new Error(`🚦 Release Artifact Audit: RED\n${errors.map((error) => `🔴 ${error}`).join("\n")}`);
  }
  console.log("🚦 Release Artifact Audit: GREEN");
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
