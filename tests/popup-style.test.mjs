import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatBuildTime } from "../build.mjs";

const liquidGlassCss = await readFile(new URL("../src/popup/liquid-glass.css", import.meta.url), "utf8");
const componentsCss = await readFile(new URL("../src/popup/components.css", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/popup/settings.ts", import.meta.url), "utf8");
const webdavSettingsSource = await readFile(new URL("../src/popup/webdav-settings.ts", import.meta.url), "utf8");
const currentPageAccountSource = await readFile(new URL("../src/popup/current-page-account.ts", import.meta.url), "utf8");

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
  assert.match(popupHtml, /id="removeWebDavVault" class="settings-danger" type="button" hidden>删除密码库<\/button>\s*<button id="testWebDav"[^>]*>测试连接<\/button>\s*<button id="saveWebDav"[^>]*>保存并连接<\/button>/s);
  assert.match(popupHtml, /id="webdavConnectionFields"[\s\S]*id="webdavVaultNameField"[^>]*>新密码库名称[\s\S]*id="webdavVaultName"/s);
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

test("current-page WebDAV empty state connects from the unchanged status badge", () => {
  assert.match(currentPageAccountSource, /current-page-add-heading/);
  assert.match(currentPageAccountSource, /current-page-add-icon/);
  assert.match(currentPageAccountSource, /WEB DAV/);
  assert.match(currentPageAccountSource, /current-page-add-badge/);
  assert.match(currentPageAccountSource, /button\("未连接", "current-page-add-badge current-page-add-connect"\)/);
  assert.match(currentPageAccountSource, /connection\.addEventListener\("click", this\.openSettings\)/);
  assert.doesNotMatch(currentPageAccountSource, /current-page-add-action/);
  assert.match(componentsCss, /\.current-page-add \{[^}]*background:\s*transparent/s);
  assert.match(componentsCss, /\.current-page-add-badge \{[^}]*min-height:\s*22px;[^}]*border-radius:\s*999px/s);
  assert.match(componentsCss, /\.current-page-add-connect:hover/);
  assert.match(componentsCss, /\.current-page-add-icon svg/);
  assert.match(componentsCss, /\.current-page-add-destination/);
});

test("an existing WebDAV profile exposes a session-safe reconnect flow", () => {
  assert.match(webdavSettingsSource, /const reconnecting = Boolean\(selected\);/);
  assert.match(webdavSettingsSource, /this\.fields\.hidden = false;/);
  assert.match(webdavSettingsSource, /this\.actions\.hidden = false;/);
  assert.match(webdavSettingsSource, /this\.nameField\.hidden = reconnecting;/);
  assert.match(webdavSettingsSource, /this\.vaultKeyField\.hidden = !reconnecting;/);
  assert.match(webdavSettingsSource, /this\.remove\.hidden = !reconnecting;/);
  assert.match(webdavSettingsSource, /window\.confirm\(`删除“\$\{selected\.name\}”吗？这只会移除扩展中的连接信息，不会删除 WebDAV 服务器上的加密数据。`\)/);
  assert.match(webdavSettingsSource, /type: "removeVault", vaultId: selected\.id/);
  assert.match(popupHtml, /id="webdavVaultKey" type="password"/);
  assert.match(popupHtml, /id="webdavRecoveryKey"[^>]*hidden/);
  assert.match(webdavSettingsSource, /showRecoveryKey\(connection\.recoveryKey\)/);
  assert.match(webdavSettingsSource, /clearSensitiveState\(\): void \{[\s\S]*this\.appPassword\.value = "";[\s\S]*this\.vaultKey\.value = "";[\s\S]*this\.recoveryKey\.value = "";[\s\S]*this\.recovery\.hidden = true;/);
  assert.match(settingsSource, /private close\(\): void \{\s*this\.webdavSettings\.clearSensitiveState\(\);/);
  assert.match(settingsSource, /dispose\(\): void \{\s*this\.disposed = true;\s*this\.webdavSettings\.clearSensitiveState\(\);/);
  assert.match(webdavSettingsSource, /this\.showStatus\("正在测试 WebDAV 连接…"\);/);
  assert.match(webdavSettingsSource, /正在重新连接 WebDAV 密码库/);
  assert.match(webdavSettingsSource, /this\.test\.textContent = this\.operation === "test" \? "测试中…" : "测试连接";/);
  assert.doesNotMatch(webdavSettingsSource, /saveGesture|advancedModeUnlock/);
  assert.match(settingsSource, /this\.saveButton\.addEventListener\("click", \(event\) => \{ event\.preventDefault\(\); this\.handleSaveClick\(\); \}\);/);
  assert.match(componentsCss, /\.webdav-status\s*\{[^}]*display:\s*flex/s);
  assert.match(componentsCss, /\.webdav-status\[hidden\][^{]*\{[^}]*display:\s*none !important/s);
  assert.match(componentsCss, /#webdavConnectionFields\s*\{[^}]*display:\s*grid/s);
  assert.match(componentsCss, /#webdavForm\s*\{[^}]*gap:\s*7px;[^}]*padding:\s*12px;/s);
  assert.match(componentsCss, /#webdavForm \.version-override input, #webdavForm \.version-override select\s*\{[^}]*height:\s*30px;/s);
  assert.match(componentsCss, /#webdavVaultNameField\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
  assert.match(componentsCss, /\.webdav-actions \.settings-danger\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
});

test("settings dialog exposes a session-only HTTPS WebDAV connection", () => {
  assert.match(popupHtml, /<span class="eyebrow">WEBDAV VAULT<\/span><h2 id="versionDialogTitle">密码库设置<\/h2>/);
  assert.match(popupHtml, /id="webdavUrl" type="url"[^>]*placeholder="https:\/\/nas\.example\.com\/dav\//);
  assert.match(popupHtml, /仅用于本次浏览器会话，不会写入本地/);
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
