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
const versionParts = String(manifest.version).split(".").map(Number);
const pluginVersion = await readFile(resolve(root, "src/shared/plugin-version.ts"), "utf8");
const storeBaselineMatch = pluginVersion.match(/STORE_PLUGIN_VERSION\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/);
if (packageJson.version !== manifest.version) errors.push("package.json 与 manifest 版本必须一致");
if (idFromKey(manifest.key) !== STORE_EXTENSION_ID) errors.push(`manifest key 必须派生为商店 ID ${STORE_EXTENSION_ID}`);
if (versionParts.length !== 3 || versionParts.some((part) => !Number.isInteger(part) || part < 0)) errors.push("manifest 版本必须为三段非负整数");
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
  "https://jupiter.tec-do.com/*",
]);

for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) errors.push(`manifest 出现未审计权限：${permission}`);
}
for (const host of manifest.host_permissions ?? []) {
  if (!allowedHosts.has(host)) errors.push(`manifest 出现未审计主机：${host}`);
  if (host === "<all_urls>" || !host.startsWith("https://")) errors.push(`manifest 主机范围不安全：${host}`);
}
if (manifest.content_scripts) errors.push("manifest 不得注册常驻 content_scripts；填充脚本必须由用户操作临时注入");

const api = await readFile(resolve(root, "src/shared/api.ts"), "utf8");
if (!api.includes("return STORE_PLUGIN_VERSION;")) {
  errors.push("UniPass 网络请求版号必须使用 STORE_PLUGIN_VERSION，不能使用本地 manifest 版本");
}
if (manifest.background?.type !== "module") errors.push("Manifest V3 Service Worker 必须保持 module 类型");
if (!String(manifest.content_security_policy?.extension_pages ?? "").includes("script-src 'self'")) {
  errors.push("扩展页面 CSP 必须限制 script-src 为 self");
}

const contentScript = await readFile(resolve(root, "src/content/content-script.ts"), "utf8");
if (/\.(?:submit|requestSubmit)\s*\(/.test(contentScript)) {
  errors.push("Content Script 不得自动提交表单");
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
  return local.length === 3 && local[0] === store[0] && local[1] === store[1] && local[2] === store[2] + 1;
}
