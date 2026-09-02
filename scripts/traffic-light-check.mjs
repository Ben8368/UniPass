import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "public/manifest.json"), "utf8"));
const errors = [];
const warnings = [];

const allowedPermissions = new Set(["activeTab", "scripting", "clipboardWrite", "storage", "alarms", "tabs"]);
const allowedHosts = new Set([
  "https://portal.unipass.top/*",
  "https://clients2.google.com/*",
  "https://clients2.googleusercontent.com/*",
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
