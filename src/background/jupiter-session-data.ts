const MAX_DEPTH = 6;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ITEMS = 128;
const MAX_STRING_LENGTH = 4_096;
const SENSITIVE_KEY_PATTERN = /(?:password|token|secret|authorization|cookie|credential|code|private|access|refresh|jwt|session)/i;

export function sanitizeJupiterUserInfo(data: Record<string, unknown>): Record<string, unknown> {
  const value = sanitizeValue(data, 0);
  return isRecord(value) ? value : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (!isRecord(value)) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const next = sanitizeValue(child, depth + 1);
    if (next !== undefined) sanitized[key] = next;
  }
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
