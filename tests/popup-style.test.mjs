import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { formatBuildTime } from "../build.mjs";

const liquidGlassCss = await readFile(new URL("../src/popup/liquid-glass.css", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");

test("build time uses the compact YYMMDD-HHMM format", () => {
  assert.equal(formatBuildTime(new Date(2026, 8, 10, 21, 12)), "260910-2112");
});

test("version settings places the build time beside the local version", () => {
  assert.match(popupHtml, /id="localBuildPluginVersion"[^>]*>检查中<\/strong><span id="localBuildTime"/);
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
