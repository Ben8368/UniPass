import { normalizeVersion } from "./version";

export const RUNTIME_CONFIG_FILE = "runtime-config.json";

export interface RuntimeConfig {
  version: 1;
  networkPluginVersion: string;
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["networkPluginVersion", "version"])) return null;
  const networkPluginVersion = normalizeVersion(candidate.networkPluginVersion);
  return candidate.version === 1 && networkPluginVersion
    ? { version: 1, networkPluginVersion }
    : null;
}
