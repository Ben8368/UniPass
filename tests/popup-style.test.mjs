import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatBuildTime } from "../build.mjs";

const liquidGlassCss = await readFile(new URL("../src/popup/liquid-glass.css", import.meta.url), "utf8");
const componentsCss = await readFile(new URL("../src/popup/components.css", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/popup/settings.ts", import.meta.url), "utf8");
const webdavSettingsSource = await readFile(new URL("../src/popup/webdav-settings.ts", import.meta.url), "utf8");

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

test("WebDAV settings keep connection actions inside the secondary panel", () => {
  assert.match(
    popupHtml,
    /id="webdavVaultName"[\s\S]*id="webdavUrl"[\s\S]*id="webdavUsername"[\s\S]*id="webdavPassword"/s,
  );
  assert.match(popupHtml, /id="testWebDav"[^>]*>测试连接<\/button>\s*<button id="saveWebDav"[^>]*>保存并连接<\/button>/s);
  assert.match(popupHtml, /id="webdavConnectionFields"[\s\S]*id="webdavVaultNameField"[^>]*>密码库名称[\s\S]*id="webdavVaultName"/s);
  assert.match(popupHtml, /id="webdavActions" class="settings-actions webdav-actions"/);
  assert.match(popupHtml, /<\/div>\s*<p id="webdavStatus" class="webdav-status" role="status" aria-live="polite" hidden><\/p>/s);
  assert.match(popupHtml, /id="webdavStatus" class="webdav-status" role="status" aria-live="polite" hidden/);
  assert.doesNotMatch(popupHtml, /id="openVaultManager"/);
  assert.match(
    componentsCss,
    /\.settings-actions > button\s*\{[^}]*height:\s*34px;[^}]*min-height:\s*34px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*margin:\s*0;/s,
  );
  assert.doesNotMatch(componentsCss, /\.settings-save\s*\{[^}]*margin-top:\s*3px/s);
  assert.match(componentsCss, /\.settings-save\s*\{[^}]*min-width:\s*84px;[^}]*background:\s*var\(--green-strong\)/s);
});

test("an existing WebDAV profile hides connection fields and actions until creating a vault", () => {
  assert.match(webdavSettingsSource, /const creating = !selected;/);
  assert.match(webdavSettingsSource, /this\.fields\.hidden = !creating;/);
  assert.match(webdavSettingsSource, /this\.actions\.hidden = !creating;/);
  assert.match(webdavSettingsSource, /this\.showStatus\("正在测试 WebDAV 连接…"\);/);
  assert.match(webdavSettingsSource, /this\.showStatus\("正在保存并连接 WebDAV 密码库…"\);/);
  assert.match(webdavSettingsSource, /this\.test\.textContent = this\.operation === "test" \? "测试中…" : "测试连接";/);
  assert.doesNotMatch(webdavSettingsSource, /saveGesture|advancedModeUnlock/);
  assert.match(settingsSource, /this\.saveButton\.addEventListener\("click", \(event\) => \{ event\.preventDefault\(\); this\.handleSaveClick\(\); \}\);/);
  assert.match(componentsCss, /\.webdav-status\s*\{[^}]*display:\s*flex/s);
  assert.match(componentsCss, /#webdavConnectionFields\s*\{[^}]*display:\s*grid/s);
});

test("settings dialog exposes a session-only HTTPS WebDAV connection", () => {
  assert.match(popupHtml, /<span class="eyebrow">WEBDAV VAULT<\/span><h2 id="versionDialogTitle">密码库设置<\/h2>/);
  assert.match(popupHtml, /id="webdavUrl" type="url"[^>]*placeholder="https:\/\/nas\.example\.com\/dav\//);
  assert.match(popupHtml, /只用于当前浏览器会话，不会写入本地配置/);
  assert.match(
    settingsSource,
    /url\.protocol !== "https:".*WebDAV 仅支持 HTTPS 地址/s,
  );
  assert.doesNotMatch(settingsSource, /WEBDAV_URL_STORAGE_KEY|openVaultManager/);
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
