import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const chromePath = await findChrome();
const userDataDir = join(tmpdir(), `unipass-chrome-smoke-${process.pid}-${Date.now()}`);
const errors = [];
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false,
  userDataDir,
  defaultViewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--load-extension=${dist}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-popup-blocking",
    ...(process.env.CHROME_SMOKE_NO_SANDBOX === "true" ? ["--no-sandbox"] : []),
  ],
});

try {
  const serviceWorkerTarget = await waitForTarget(browser, (target) =>
    target.type() === "service_worker" && target.url().endsWith("/background/service-worker.js"));
  const extensionId = new URL(serviceWorkerTarget.url()).hostname;
  assert.match(extensionId, /^[a-p]{32}$/);

  const popup = await browser.newPage();
  popup.on("console", (message) => {
    if (message.type() === "error") errors.push(`popup console: ${message.text()}`);
  });
  popup.on("pageerror", (error) => errors.push(`popup page error: ${error.message}`));
  await waitForExtensionPage(popup, `chrome-extension://${extensionId}/popup.html`);
  assert.equal(await popup.title(), "UniPass");
  const loadedManifest = await popup.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("manifest.json"));
    return response.json();
  });
  assert.equal(loadedManifest.manifest_version, 3);
  assert.equal(loadedManifest.name, manifest.name);

  const initialWorker = await waitForWorker(serviceWorkerTarget);
  await assertWasmLoads(initialWorker);

  assert.equal(await popup.evaluate(() => typeof chrome.runtime.reload), "function");
  await popup.evaluate(() => {
    setTimeout(() => chrome.runtime.reload(), 0);
    return true;
  });

  const restartedPopup = await browser.newPage();
  restartedPopup.on("console", (message) => {
    if (message.type() === "error") errors.push(`restarted popup console: ${message.text()}`);
  });
  restartedPopup.on("pageerror", (error) => errors.push(`restarted popup page error: ${error.message}`));
  await waitForExtensionPage(restartedPopup, `chrome-extension://${extensionId}/popup.html`);
  const restartedTarget = await waitForTarget(browser, (target) => target.type() === "service_worker" && target !== serviceWorkerTarget, { timeout: 15_000 });
  await assertWasmLoads(await waitForWorker(restartedTarget));

  assert.deepEqual(errors, [], `extension console errors:\n${errors.join("\n")}`);
  const browserLabel = /edge|msedge/i.test(chromePath) ? "Chromium-compatible browser" : "Chrome";
  console.log(`${browserLabel} smoke GREEN: MV3 manifest, popup, Service Worker, WASM and restart (${chromePath})`);
} finally {
  await browser.close();
  await rm(userDataDir, { recursive: true, force: true });
}

async function assertWasmLoads(worker) {
  const result = await worker.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("credential-core.wasm"), { cache: "no-store" });
    if (!response.ok) throw new Error(`WASM fetch HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const module = await WebAssembly.compile(bytes);
    await WebAssembly.instantiate(module, {});
    return {
      imports: WebAssembly.Module.imports(module).length,
      exports: WebAssembly.Module.exports(module).map(({ name }) => name).sort(),
    };
  });
  assert.equal(result.imports, 0);
  assert.deepEqual(result.exports, ["c_a", "c_f", "c_k", "c_u", "c_v", "memory"]);
}

async function waitForWorker(target) {
  const worker = target.worker();
  if (!worker) throw new Error(`无法获取 Service Worker：${target.url()}`);
  return worker;
}

async function waitForTarget(browserInstance, predicate, { timeout = 10_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const target = browserInstance.targets().find(predicate);
    if (target) return target;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("等待 Chrome 扩展目标超时");
}

async function waitForExtensionPage(page, url, { timeout = 15_000 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      if (!String(error).includes("ERR_BLOCKED_BY_CLIENT")) throw error;
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw lastError ?? new Error("等待重载后的扩展页面超时");
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROME_PATH,
    process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined,
    process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined,
    process.platform === "win32" ? "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" : undefined,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard installation path.
    }
  }
  throw new Error("找不到 Chrome/Chromium；可通过 CHROME_BIN 指定可执行文件");
}
