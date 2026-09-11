import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatBuildTime } from "../build.mjs";

const liquidGlassCss = await readFile(new URL("../src/popup/liquid-glass.css", import.meta.url), "utf8");
const componentsCss = await readFile(new URL("../src/popup/components.css", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/popup/settings.ts", import.meta.url), "utf8");

test("build time uses the compact YYMMDD-HHMM format", () => {
  assert.equal(formatBuildTime(new Date(2026, 8, 10, 21, 12)), "260910-2112");
});

test("version settings places the build time beside the local version", () => {
  assert.match(popupHtml, /id="localBuildPluginVersion"[^>]*>检查中<\/strong><span id="localBuildTime"/);
});

test("WebDAV actions keep their positions while hiding build settings", () => {
  assert.match(popupHtml, /id="legacyBuildSettings" hidden[^>]*aria-hidden="true"/);
  assert.match(popupHtml, /id="versionSave"[^>]*>保存设置<\/button>/);
  assert.match(popupHtml, /id="restorePluginVersionBaseline"[^>]*disabled[^>]*>恢复默认<\/button>/);
  assert.match(popupHtml, /id="selfBuildDialogTitle">生成本地升级构建<\/h2>/);
  assert.match(settingsSource, /this\.restoreBaseline\.textContent = unlockReady \? "解锁高级模式" : "恢复默认"/);
});

test("WebDAV actions use a clear primary-first order and shared alignment", () => {
  assert.match(
    popupHtml,
    /id="versionSave"[^>]*>保存设置<\/button>\s*<button id="openVaultManager"[^>]*>打开 Vault 管理<\/button>\s*<button id="restorePluginVersionBaseline"/s,
  );
  assert.match(
    componentsCss,
    /\.settings-actions > button\s*\{[^}]*height:\s*34px;[^}]*min-height:\s*34px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*margin:\s*0;/s,
  );
  assert.doesNotMatch(componentsCss, /\.settings-save\s*\{[^}]*margin-top:\s*3px/s);
  assert.match(componentsCss, /\.settings-save\s*\{[^}]*min-width:\s*84px;[^}]*background:\s*var\(--green-strong\)/s);
});

test("settings dialog exposes an HTTPS-only WebDAV address field", () => {
  assert.match(popupHtml, /<span class="eyebrow">WEBDAV<\/span><h2 id="versionDialogTitle">WebDAV 地址设置<\/h2>/);
  assert.match(popupHtml, /id="webdavUrl" type="url"[^>]*placeholder="https:\/\/nas\.example\.com\/dav\//);
  assert.match(popupHtml, /当前仅保存地址，不会上传密码或发起连接/);
  assert.match(
    settingsSource,
    /url\.protocol !== "https:".*WebDAV 仅支持 HTTPS 地址/s,
  );
  assert.match(settingsSource, /WEBDAV_URL_STORAGE_KEY = "unipass-webdav-url"/);
});

test("dark online session badge removes its fill on hover", () => {
  assert.match(
    liquidGlassCss,
    /:root\[data-theme="dark"\] \.session-badge\.online:not\(:disabled\):hover\s*\{[^}]*background:\s*transparent;[^}]*filter:\s*none;[^}]*\}/s,
  );
});

test("version settings uses theme-aware layered glass without changing the main window", () => {
  assert.match(
    liquidGlassCss,
    /:root\s*\{[^}]*--dialog-glass:\s*rgba\([^;]+;[^}]*--dialog-panel:\s*rgba\([^;]+;/s,
  );
  assert.match(
    liquidGlassCss,
    /:root\[data-theme="light"\]\s*\{[^}]*--dialog-glass:\s*rgba\([^;]+;[^}]*--dialog-panel:\s*rgba\([^;]+;/s,
  );
  assert.match(
    liquidGlassCss,
    /:root\[data-theme="light"\]\s*\{[^}]*--dialog-scrim:\s*rgba\(255, 255, 255, \.32\);/s,
  );
  assert.match(
    liquidGlassCss,
    /\.dialog-backdrop\s*\{[^}]*background:\s*var\(--dialog-scrim\);[^}]*backdrop-filter:\s*blur\(10px\) saturate\(120%\)/s,
  );
  assert.match(
    liquidGlassCss,
    /\.version-dialog\s*\{[^}]*background-color:\s*var\(--dialog-glass\);[^}]*backdrop-filter:\s*blur\(24px\) saturate\(155%\)/s,
  );
  assert.match(
    liquidGlassCss,
    /\.version-dialog\s*\{[^}]*feTurbulence type='fractalNoise'[^}]*opacity='\.12'[^}]*background-blend-mode:\s*soft-light;/s,
  );
  assert.match(
    liquidGlassCss,
    /\.version-dialog \.settings-form\s*\{[^}]*background:\s*var\(--dialog-panel\);[^}]*backdrop-filter:\s*blur\(8px\)/s,
  );
});
