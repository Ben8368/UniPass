import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const popupSource = await readFile(new URL("../src/popup/credentials.ts", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../src/popup/catalog.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/background/service-worker.ts", import.meta.url), "utf8");
const overlaySource = await readFile(new URL("../src/background/page-overlay.ts", import.meta.url), "utf8");
const contentOverlaySource = await readFile(new URL("../src/content/page-overlay.ts", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/popup/settings.ts", import.meta.url), "utf8");
const webdavSettingsSource = await readFile(new URL("../src/popup/webdav-settings.ts", import.meta.url), "utf8");
const currentPageAccountSource = await readFile(new URL("../src/popup/current-page-account.ts", import.meta.url), "utf8");

test("Popup delegates credential filling to the Service Worker", () => {
  assert.match(popupSource, /type: "fillFromPopup"/);
  assert.doesNotMatch(popupSource, /fallbackUsername/);
  assert.doesNotMatch(popupSource, /response\.password/);
  assert.doesNotMatch(popupSource, /chrome\.scripting\.executeScript/);
  assert.match(workerSource, /case "fillFromPopup":\s+return requiresUniPassScope\(message\) \? withUserScope\(message\.userScope \?\? "", \(\) => fillFromPopup\(message\)\) : fillFromPopup\(message\)/);
  assert.match(workerSource, /function requiresUniPassScope[\s\S]*?message\.accountRef\.vaultId === "legacy-unipass"/);
  assert.match(overlaySource, /export async function fillFromPopup/);
  assert.match(overlaySource, /credential = await credentialForAccount\(message\.accountId\)/);
});

test("Service Worker rechecks the user scope before filling a credential", () => {
  assert.match(overlaySource, /import \{ assertCurrentUserScope \} from "\.\/user-scope-guard"/);
  assert.match(
    overlaySource,
    /credential = await credentialForAccount\([\s\S]*?if \(requiresScope\) await assertCurrentUserScope\(message\.userScope \?\? ""\)[\s\S]*?executeScript/,
  );
  assert.match(
    overlaySource,
    /if \(!injection\?\.documentId\)[\s\S]*?if \(requiresScope\) await assertCurrentUserScope\(message\.userScope \?\? ""\)[\s\S]*?sendMessage/,
  );
});

test("Reveal has a distinct Advanced-only background path", () => {
  assert.match(workerSource, /case "revealCredential":/);
  assert.match(workerSource, /advancedCapabilities\.require\(sender\)/);
  assert.match(workerSource, /credentialForAccount\(message\.accountId\)/);
  assert.doesNotMatch(workerSource, /case "credential":/);
});

test("Popup Advanced mode is ephemeral and uses a handshaken Port", () => {
  assert.match(settingsSource, /send<string>\(\{ type: "enableAdvancedMode" \}\)/);
  assert.match(settingsSource, /chrome\.runtime\.connect\(\{ name: ADVANCED_MODE_PORT_NAME \}\)/);
  assert.match(settingsSource, /type: "advancedModeHandshake", token/);
  assert.match(settingsSource, /port\.onDisconnect\.addListener/);
  assert.match(settingsSource, /dispose\(\): void/);
  assert.doesNotMatch(settingsSource, /chrome\.storage|localStorage.*advanced|advanced.*localStorage/i);
});

test("settings connects WebDAV inside the extension UI without opening a management tab", () => {
  assert.match(settingsSource, /new WebDavSettingsController\(reportStatus\)/);
  assert.doesNotMatch(settingsSource, /openVaultManager|chrome\.tabs\.create/);
  assert.match(webdavSettingsSource, /type: "requestWebDavPermission"/);
  assert.match(webdavSettingsSource, /type: "testWebDavConnection"/);
  assert.match(webdavSettingsSource, /type: "saveWebDavVault"/);
  assert.match(webdavSettingsSource, /type: "removeVault"/);
  assert.match(workerSource, /sender\.id !== chrome\.runtime\.id/);
  assert.match(workerSource, /case "requestWebDavPermission":[\s\S]*chrome\.permissions\.request/);
  assert.match(workerSource, /case "removeVault":\s+return requireVaultManager\(sender, \(\) => removeVault\(message\.vaultId\)\)/);
  assert.doesNotMatch(workerSource, /case "openVaultManager"/);
});

test("page overlay keeps editable keystrokes inside the Shadow DOM", () => {
  assert.match(contentOverlaySource, /stopEditableKeyPropagation/);
  assert.match(contentOverlaySource, /target\.matches\("input, textarea, select"\) \|\| target\.isContentEditable/);
  assert.match(contentOverlaySource, /event\.stopPropagation\(\)/);
  assert.match(contentOverlaySource, /\["keydown", "keypress", "keyup"\]/);
  assert.doesNotMatch(contentOverlaySource, /stopEditableKeyPropagation[\s\S]*event\.preventDefault\(\)/);
});

test("an empty current page offers an inline WebDAV account form", () => {
  assert.match(catalogSource, /listVaultConnectionStates/);
  assert.match(catalogSource, /if \(!accounts\.length\) await this\.currentPageEditor\.render\(tab, catalog\.entries, connectionStates\)/);
  assert.match(currentPageAccountSource, /这个页面还没有保存账号/);
  assert.match(currentPageAccountSource, /type: "createVaultApp"/);
  assert.match(currentPageAccountSource, /type: "createVaultAccount"/);
  assert.match(currentPageAccountSource, /vaultTargetMatches\(target, url\)/);
});

test("a disconnected WebDAV Vault is routed to reconnect instead of an empty-account form", () => {
  assert.match(workerSource, /case "listVaultConnectionStates":\s+return requireVaultManager\(sender, listVaultConnectionStates\)/);
  assert.match(currentPageAccountSource, /账号仍在密码库中，需要重新连接/);
  assert.match(currentPageAccountSource, /重新连接 \$\{state\.name\}/);
  assert.match(currentPageAccountSource, /new CustomEvent\("unipass-open-webdav-settings", \{ detail: \{ vaultId: state\.vaultId \} \}\)/);
  assert.match(settingsSource, /event\.detail\?\.vaultId/);
  assert.match(webdavSettingsSource, /async open\(vaultId\?: string\)/);
});

test("a disconnected Vault does not masquerade as a UniPass application sync failure", () => {
  assert.match(catalogSource, /密码库 \$\{names\} 需要重新连接，账号目录未读取/);
  assert.match(catalogSource, /const reconnectFailures = result\.failures\.filter/);
  assert.match(catalogSource, /const otherFailures = result\.failures\.filter/);
});

test("application cards keep their icon and only view accounts in advanced mode", () => {
  assert.match(catalogSource, /root\.className = "item app-item"/);
  assert.match(catalogSource, /root\.append\(this\.appIcon\(title, app\), main, actions\)/);
  assert.match(catalogSource, /slot\.append\(icon\);\s+return slot/);
  assert.match(catalogSource, /icon\.addEventListener\("click", \(\) => \{\s*if \(this\.isAdvancedModeEnabled\(\)\) void this\.loadAppAccounts\(app\);\s*\}\)/);
  assert.match(catalogSource, /const open = button\("打开页面"\);[\s\S]*?open\.addEventListener\("click", \(\) => void this\.openAppPage\(app\)\)/);
});

test("application cards use the background availability aggregate and explain filtered states", () => {
  assert.match(catalogSource, /send<AvailableAppsResult>\(\{ type: "listApps"/);
  assert.match(catalogSource, /normalizeAvailableAppsResult/);
  assert.match(catalogSource, /if \(Array\.isArray\(value\)\)/);
  assert.match(catalogSource, /应用列表返回格式异常，请重新加载扩展/);
  assert.match(catalogSource, /excludedEmptyCredentialApps/);
  assert.match(catalogSource, /excludedVerificationFailureApps/);
  assert.match(catalogSource, /excludedDirectoryFailureApps/);
  assert.match(catalogSource, /没有可用密码，已隐藏/);
  assert.match(catalogSource, /凭据暂时无法验证，已隐藏/);
  assert.match(catalogSource, /账号目录同步失败，已隐藏/);
});

test("current-page account cards only show viewing in advanced mode before filling", () => {
  assert.match(catalogSource, /if \(this\.isAdvancedModeEnabled\(\)\) \{[\s\S]*?const view = button\("查看"\);[\s\S]*?actions\.append\(view\);[\s\S]*?\}\s*actions\.append\(fill\)/);
});
