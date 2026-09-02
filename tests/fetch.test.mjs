import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/fetch.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { fetchJsonWithTimeout, fetchWithTimeout } = await import(moduleUrl);

test("fetch timeout returns a stable user-facing error", async () => {
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

  await assert.rejects(fetchWithTimeout("https://example.test", {}, 5), {
    message: "网络请求超时，请稍后重试",
  });
});

test("network failures do not expose the original error", async () => {
  globalThis.fetch = async () => {
    throw new Error("secret upstream detail");
  };

  await assert.rejects(fetchWithTimeout("https://example.test", {}, 50), {
    message: "网络请求失败，请稍后重试",
  });
});

test("JSON response body parsing is covered by the timeout", async () => {
  globalThis.fetch = async (_input, init) => ({
    ok: true,
    status: 200,
    async json() {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    },
  });

  await assert.rejects(fetchJsonWithTimeout("https://example.test", {}, 5), {
    message: "网络请求超时，请稍后重试",
  });
});
