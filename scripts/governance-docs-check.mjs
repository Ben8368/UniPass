import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const budgets = [
  { file: "AGENTS.md", lines: 80, characters: 4800 },
  { file: "CONTEXT.md", lines: 45, characters: 2800 },
  { file: "LESSONS.md", lines: 20, characters: 1600 },
];
const requiredFiles = [
  "AGENTS.md",
  "CONTEXT.md",
  "LESSONS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/AI_RULES.md",
  "docs/ARCHITECTURE.md",
  "docs/GOVERNANCE.md",
  "docs/TECH_DEBT.md",
  "docs/ADR/README.md",
  "docs/ADR/0001-ai-governance-entry.md",
  "docs/lessons/governance.md",
  "docs/lessons/extension-security.md",
  "docs/lessons/windows.md",
  ".github/pull_request_template.md",
];
const linkedDocuments = [
  ...requiredFiles.filter((file) => file.endsWith(".md")),
  "README.md",
];
const errors = [];
const contents = new Map();

for (const file of requiredFiles) {
  try {
    contents.set(file, await readFile(resolve(root, file), "utf8"));
  } catch {
    errors.push(`缺少治理文件：${file}`);
  }
}

for (const budget of budgets) {
  const content = contents.get(budget.file);
  if (!content) continue;
  const lines = content.trimEnd().split(/\r?\n/).length;
  const characters = [...content].length;
  if (lines > budget.lines || characters > budget.characters) {
    errors.push(`${budget.file}: ${lines}/${budget.lines} 行，${characters}/${budget.characters} 字符`);
  }
}

const requiredSections = {
  "AGENTS.md": ["## 开局与按需读取", "## 不可跨越的边界", "## 治理文档自治理", "docs/GOVERNANCE.md"],
  "CONTEXT.md": ["## 当前决策", "## 近期优先级", "## 按需入口"],
  "LESSONS.md": ["docs/lessons/governance.md", "docs/lessons/extension-security.md", "docs/lessons/windows.md"],
  "docs/AI_RULES.md": ["## 1. 红绿灯审查系统", "## 3. 审查与验证顺序", "🚦 Audit Report"],
};

for (const [file, sections] of Object.entries(requiredSections)) {
  const content = contents.get(file);
  if (!content) continue;
  for (const section of sections) {
    if (!content.includes(section)) errors.push(`${file}: 缺少必需章节或路由“${section}”`);
  }
}

const context = contents.get("CONTEXT.md") ?? "";
const priorities = [...context.matchAll(/^\d+\. /gm)].length;
if (priorities < 1 || priorities > 3) {
  errors.push(`CONTEXT.md: 近期优先级应为 1-3 项，当前为 ${priorities} 项`);
}
for (const forbidden of ["当前分支", "最近更新", "## 常用命令", "## 变更日志"]) {
  if (context.includes(forbidden)) errors.push(`CONTEXT.md: 不应包含“${forbidden}”`);
}

for (const file of linkedDocuments) {
  const content = contents.get(file) ?? await readFile(resolve(root, file), "utf8").catch(() => "");
  if (!content) continue;
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1].trim();
    if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split("#", 1)[0]);
    if (!target) continue;
    try {
      await access(resolve(root, dirname(file), target));
    } catch {
      errors.push(`${file}: 本地链接不存在“${href}”`);
    }
  }
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
for (const script of [
  "docs:governance:check",
  "audit:static",
  "test",
  "typecheck",
  "build",
  "rust:fmt",
  "rust:test",
  "rust:clippy",
  "rust:clippy:wasm",
  "rust:build",
  "verify:rust",
  "verify:wasm-reproducible",
  "build:hardened",
  "audit:hardened",
  "verify:hardened:diversity",
  "smoke:chrome",
  "smoke:chrome:hardened",
  "verify",
]) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json: 缺少脚本“${script}”`);
}

if (errors.length) {
  console.error("治理文档检查失败：");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("治理文档检查通过。");
}
