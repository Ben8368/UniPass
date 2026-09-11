import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "public/manifest.json"), "utf8"));
const errors = [];
const warnings = [];
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const STORE_EXTENSION_ID = "gjphikebcceegfolnbfncepfmjnhdkam";
const STORE_UPDATE_URL = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0.0.0&acceptformat=crx3&x=id%3D${STORE_EXTENSION_ID}%26installsource%3Dondemand%26uc`;
const idFromKey = (key) => [...createHash("sha256").update(Buffer.from(key ?? "", "base64")).digest("hex").slice(0, 32)].map((nibble) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16))).join("");
const CHROME_VERSION_COMPONENT_MAX = 65535;
const versionParts = parseChromeVersion(manifest.version);
const pluginVersion = await readFile(resolve(root, "src/shared/plugin-version.ts"), "utf8");
const rustToolchain = await readFile(resolve(root, "rust-toolchain.toml"), "utf8");
const rustManifest = await readFile(resolve(root, "credential-core/Cargo.toml"), "utf8");
const rustLock = await readFile(resolve(root, "credential-core/Cargo.lock"), "utf8");
const security = await readFile(resolve(root, "SECURITY.md"), "utf8");
const workflowFiles = [".github/workflows/ci.yml", ".github/workflows/release.yml"];
const storeBaselineMatch = pluginVersion.match(/STORE_PLUGIN_VERSION\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/);
if (packageJson.version !== manifest.version) errors.push("package.json 与 manifest 版本必须一致");
if (idFromKey(manifest.key) !== STORE_EXTENSION_ID) errors.push(`manifest key 必须派生为商店 ID ${STORE_EXTENSION_ID}`);
if (!versionParts) errors.push("manifest 版本必须为三段非负整数，且每段不超过 65535");
if (!storeBaselineMatch) {
  errors.push("必须在 src/shared/plugin-version.ts 声明三段式 STORE_PLUGIN_VERSION");
} else if (!isNextPatchVersion(versionParts, storeBaselineMatch.slice(1, 4).map(Number))) {
  errors.push(`本地 manifest 版本必须恰为网络商店基线 ${storeBaselineMatch.slice(1, 4).join(".")} 的下一补丁版；实际为 ${manifest.version}`);
}

try {
  const storeVersion = await fetchStoreVersion();
  console.log(`Store version: ${storeVersion.join(".")} | Local version: ${manifest.version}`);
  if (!isNextPatchVersion(versionParts, storeVersion)) {
    errors.push(`本地版本必须恰为当前商店版 ${storeVersion.join(".")} 的下一补丁版；实际为 ${manifest.version}`);
  }
  if (storeBaselineMatch && storeBaselineMatch.slice(1, 4).join(".") !== storeVersion.join(".")) {
    errors.push(`网络商店基线必须等于 Chrome 官方当前商店版 ${storeVersion.join(".")}；实际为 ${storeBaselineMatch.slice(1, 4).join(".")}`);
  }
} catch (error) {
  errors.push(`无法从 Chrome 官方更新接口查询商店版号，按替身门禁阻断：${error instanceof Error ? error.message : String(error)}`);
}

const allowedPermissions = new Set(["activeTab", "scripting", "clipboardWrite", "storage", "alarms", "tabs"]);
const allowedHosts = new Set([
  "https://portal.unipass.top/*",
  "https://accounts.feishu.cn/*",
  "https://jupiter.tec-do.com/*",
]);

for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) errors.push(`manifest 出现未审计权限：${permission}`);
}
for (const host of manifest.host_permissions ?? []) {
  if (!allowedHosts.has(host)) errors.push(`manifest 出现未审计主机：${host}`);
  if (host === "<all_urls>" || !host.startsWith("https://")) errors.push(`manifest 主机范围不安全：${host}`);
}
for (const host of manifest.optional_host_permissions ?? []) {
  if (host !== "https://*/*") errors.push(`manifest 出现未审计可选主机：${host}`);
  if (host === "<all_urls>" || !host.startsWith("https://")) errors.push(`manifest 可选主机范围不安全：${host}`);
}
if (manifest.content_scripts) errors.push("manifest 不得注册常驻 content_scripts；填充脚本必须由用户操作临时注入");

const api = await readFile(resolve(root, "src/shared/api.ts"), "utf8");
if (!api.includes("readPluginVersionOverride") || !api.includes("readRuntimeConfig") || !api.includes("RUNTIME_CONFIG_FILE")) {
  errors.push("UniPass 网络请求版号必须以经校验的手动覆盖或本地 runtime-config.json 为来源，不能使用本地 manifest 版本");
}
if (manifest.background?.type !== "module") errors.push("Manifest V3 Service Worker 必须保持 module 类型");
if (!String(manifest.content_security_policy?.extension_pages ?? "").includes("script-src 'self'")) {
  errors.push("扩展页面 CSP 必须限制 script-src 为 self");
}
if (!String(manifest.content_security_policy?.extension_pages ?? "").includes("'wasm-unsafe-eval'")) {
  errors.push("本地 credential core 需要 MV3 CSP 明确允许 wasm-unsafe-eval");
}

const packageDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
if (packageDependencies["crypto-js"] || packageDependencies["@types/crypto-js"]) {
  errors.push("credential core 迁移后不得继续依赖 crypto-js 或其类型包");
}
if (/CryptoJS|VlXCSJg7qO66MNrMMJir3g==/.test(api)) {
  errors.push("UniPass API 生产源码不得保留 CryptoJS 或完整固定解密材料");
}
if (!/channel\s*=\s*["']1\.98\.1["']/.test(rustToolchain)) errors.push("Rust toolchain 必须固定为 1.98.1");
if (!/edition\s*=\s*["']2024["']/.test(rustManifest)) errors.push("credential-core 必须使用 Rust 2024 edition");
if (/\bgit\s*=|git\+/.test(`${rustManifest}\n${rustLock}`)) errors.push("Rust 依赖不得使用 git source");

for (const workflowFile of workflowFiles) {
  const workflow = (await readFile(resolve(root, workflowFile), "utf8")).replaceAll("\r\n", "\n");
  for (const match of workflow.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/g)) {
    if (!/^[0-9a-f]{40}$/i.test(match[2])) {
      errors.push(`${workflowFile} 的外部 Action 必须 pin 到完整 SHA：${match[1]}@${match[2]}`);
    }
  }
}
const releaseWorkflow = (await readFile(resolve(root, ".github/workflows/release.yml"), "utf8")).replaceAll("\r\n", "\n");
if (!releaseWorkflow.includes("needs: [dependency-audit, verify, hardened]")) {
  errors.push("Release publish job 必须依赖 verify、hardened 与 RustSec dependency-audit");
}
if (!releaseWorkflow.includes("permissions:\n      contents: write")) {
  errors.push("Release publish job 必须单独声明 contents: write");
}

const credentialCore = await readFile(resolve(root, "src/background/credential-core.ts"), "utf8");
if (!credentialCore.includes("chrome.runtime.getURL(CORE_FILE)") || !credentialCore.includes("WebAssembly.instantiate")) {
  errors.push("credential core 必须从扩展本地 URL 通过单一 loader 初始化");
}
for (const exportName of ["c_v", "c_k", "credentialAvailableCiphertext", "transformJupiterCredentialCiphertext"]) {
  if (!credentialCore.includes(exportName)) errors.push(`credential core 缺少 ${exportName} 路径`);
}
if (credentialCore.includes("transformJupiterPassword")) errors.push("生产 JS 不得暴露原始 Jupiter password transform API");

const jupiterKeepalive = await readFile(resolve(root, "src/background/jupiter-keepalive.ts"), "utf8");
if (!jupiterKeepalive.includes("jupiterCredentialForAccount") || /credentialForAccount|transformJupiterPassword/.test(jupiterKeepalive)) {
  errors.push("Jupiter keepalive 必须直接使用 ciphertext combined transform，不得取得原始 password");
}

const contentScript = await readFile(resolve(root, "src/content/content-script.ts"), "utf8");
if (/\.(?:submit|requestSubmit)\s*\(/.test(contentScript)) {
  errors.push("Content Script 不得自动提交表单");
}
if (contentScript.includes("data-unipass-minimal-listener") || !contentScript.includes("__unipassMinimalListenerInstalled")) {
  errors.push("Content Script listener 状态必须使用 isolated-world 状态，不得依赖页面 DOM marker");
}
if (!security.includes("Jupiter transformedPassword") || !security.includes("credential-equivalent secret")) {
  errors.push("SECURITY.md 必须将 Jupiter transformedPassword 分类为 credential-equivalent secret");
}
for (const workflowFile of workflowFiles) {
  const workflow = await readFile(resolve(root, workflowFile), "utf8");
  if (/for attempt[\s\S]*npm run verify/.test(workflow)) {
    errors.push(`${workflowFile} 不得整体重试 npm run verify`);
  }
}

const buildScript = await readFile(resolve(root, "build.mjs"), "utf8");
for (const [pattern, error] of [
  [/\bminify:\s*true\b/, "发布构建必须启用标准 minify"],
  [/\bsourcemap:\s*false\b/, "发布构建必须关闭 sourcemap"],
  [/\btreeShaking:\s*true\b/, "发布构建必须启用 tree shaking"],
  [/\bdrop:\s*\[\s*["']debugger["']\s*\]/, "发布构建必须移除 debugger"],
  [/\blegalComments:\s*["']eof["']/, "发布构建必须在文件末尾保留第三方许可声明"],
  [/\baudit\s*=\s*assertReleaseArtifact/, "普通构建必须使用 release artifact audit"],
  [/\bawait\s+audit\(out\)/, "构建完成后必须审计最终 dist 产物"],
  [/\bconst\s+wasmPath\s*=\s*resolve\(out,\s*["']credential-core\.wasm["']\)/, "构建必须生成并复制 credential-core.wasm"],
]) {
  if (!pattern.test(buildScript)) errors.push(error);
}

const loginAssistant = await readFile(resolve(root, "src/background/unipass-login.ts"), "utf8");
if (!loginAssistant.includes('url.searchParams.get("client_id") === "cli_aae6da4f6538dbed"')
  || !loginAssistant.includes('url.searchParams.get("redirect_uri") === "https://tec-iam.tec-do.com/portal/api/v1/login/feishu_oauth/gboh9uvzolazw62gmxojwaarust5qyvh"')) {
  errors.push("飞书授权点击必须同时固定 Tec-IAM OAuth client_id 和 redirect_uri");
}

for (const file of await sourceFiles(resolve(root, "src"))) {
  const content = await readFile(file, "utf8");
  const lines = content.trimEnd().split(/\r?\n/).length;
  const label = relative(root, file).replaceAll("\\", "/");
  if (lines > 650) errors.push(`${label}: ${lines} 行，超过 650 行红灯阈值`);
  else if (lines > 500) warnings.push(`${label}: ${lines} 行，超过 500 行黄灯阈值，应按 TECH_DEBT 跟踪拆分`);
  else if (lines > 350) warnings.push(`${label}: ${lines} 行，审查时需确认单一职责`);
}

if (errors.length) {
  console.error("🚦 Static Audit: RED");
  for (const error of errors) console.error(`🔴 ${error}`);
  for (const warning of warnings) console.warn(`🟡 ${warning}`);
  process.exitCode = 1;
} else if (warnings.length) {
  console.warn("🚦 Static Audit: YELLOW");
  for (const warning of warnings) console.warn(`🟡 ${warning}`);
} else {
  console.log("🚦 Static Audit: GREEN");
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

async function fetchStoreVersion() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(STORE_UPDATE_URL, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`更新接口返回 HTTP ${response.status}`);
    const match = response.url.match(/_(\d+)_(\d+)_(\d+)(?:_\d+)?\.crx(?:$|[?#])/i);
    if (!match) throw new Error("更新重定向地址未包含可解析的 CRX 版号");
    return match.slice(1, 4).map(Number);
  } finally {
    clearTimeout(timeout);
  }
}

function isNextPatchVersion(local, store) {
  return Array.isArray(local) && Array.isArray(store)
    && local.length === 3 && store.length === 3
    && local[0] === store[0] && local[1] === store[1] && local[2] === store[2] + 1;
}

function parseChromeVersion(value) {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= CHROME_VERSION_COMPONENT_MAX) ? parts : null;
}
