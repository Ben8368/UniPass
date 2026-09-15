import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/chrome-smoke.mjs", import.meta.url), "utf8");
const systemAuthSmokeSource = await readFile(new URL("../scripts/system-auth-smoke.mjs", import.meta.url), "utf8");

test("Chrome smoke uses Puppeteer's extension loader and platform discovery", () => {
  assert.match(source, /enableExtensions:\s*\[extensionDirectory\]/);
  assert.match(source, /pipe:\s*true/);
  assert.doesNotMatch(source, /Microsoft\\?\\?Edge|msedge/i);
  assert.equal(source.includes("Program Files"), false);
  assert.equal(source.includes("Applications/Google Chrome"), false);
  assert.equal(source.includes("/usr/bin/google-chrome"), false);
  assert.match(source, /CHROME_BIN/);
  assert.match(source, /findChromeFromWindowsRegistry/);
});

test("Chrome smoke activates hidden self-build compatibility controls from page context", () => {
  assert.match(source, /async function triggerSelfBuildCompatibilityGesture\(popup, value\)/);
  assert.match(source, /await popup\.evaluate\(\(targetVersion\) => \{/);
  assert.match(source, /save\.click\(\);\s*save\.click\(\);\s*save\.click\(\);/s);
  assert.doesNotMatch(source, /await popup\.click\("#versionSave"\)/);
});

test("Chrome smoke verifies the extension WebAuthn registration and signed Advanced authorization", () => {
  assert.match(source, /import \{ assertSystemAuthenticatorFlow \} from "\.\/system-auth-smoke\.mjs"/);
  assert.match(source, /await assertSystemAuthenticatorFlow\(popup, extensionId\)/);
  assert.match(systemAuthSmokeSource, /WebAuthn\.addVirtualAuthenticator/);
  assert.match(systemAuthSmokeSource, /type: "beginSystemAuthenticator", purpose: "register"/);
  assert.match(systemAuthSmokeSource, /type: "saveSystemAuthenticator"/);
  assert.match(systemAuthSmokeSource, /type: "enableAdvancedMode", systemAuth: assertion/);
  assert.match(systemAuthSmokeSource, /createHash\("sha256"\)\.update\(result\.origin\)\.digest\("base64url"\)/);
  assert.match(systemAuthSmokeSource, /请求已失效/);
});
