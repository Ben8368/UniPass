export const SELF_BUILD_STATIC_FILES = Object.freeze([
  "background/service-worker.js",
  "components.css",
  "content/content-script.js",
  "content/page-overlay.js",
  "credential-core.wasm",
  "icons/icon128.png",
  "icons/icon16.png",
  "icons/icon48.png",
  "liquid-glass.css",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  "runtime-config.json",
  "self-build-files.json",
  "theme.css",
]);

export interface SelfBuildFileResponse {
  base64: string;
}
