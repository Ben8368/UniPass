/**
 * Version declared to UniPass by every runtime API request.
 *
 * The locally loaded replacement intentionally stays one patch ahead of the
 * Chrome Web Store build so Chrome does not replace it. This is a per-build
 * snapshot: before each development build, verification reads the live store
 * version and rejects the build until this value matches it exactly.
 */
export const STORE_PLUGIN_VERSION = "5.3.0";
export const PLUGIN_VERSION_OVERRIDE_STORAGE_KEY = "unipassNetworkVersionOverride";

export function normalizePluginVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  return version;
}
