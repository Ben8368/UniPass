import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const liquidGlassCss = await readFile(new URL("../src/popup/liquid-glass.css", import.meta.url), "utf8");

test("dark online session badge removes its fill on hover", () => {
  assert.match(
    liquidGlassCss,
    /:root\[data-theme="dark"\] \.session-badge\.online:not\(:disabled\):hover\s*\{[^}]*background:\s*transparent;[^}]*filter:\s*none;[^}]*\}/s,
  );
});
