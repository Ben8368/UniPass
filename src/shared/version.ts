export type VersionParts = readonly [number, number, number];

export const CHROME_VERSION_COMPONENT_MAX = 65535;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value: unknown): VersionParts | null {
  if (typeof value !== "string") return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return parts.every((part) => part >= 0 && part <= CHROME_VERSION_COMPONENT_MAX) ? parts : null;
}

export function normalizeVersion(value: unknown): string | null {
  const parts = parseVersion(value);
  return parts ? parts.join(".") : null;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error("版本格式无效");
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

export function deriveNetworkVersion(targetLocalVersion: string): string {
  const parts = parseVersion(targetLocalVersion);
  if (!parts) throw new Error("目标版本格式无效");
  if (parts[2] < 1) throw new Error("自构建目标版本的 patch 必须至少为 1");
  return `${parts[0]}.${parts[1]}.${parts[2] - 1}`;
}

export function assertLocalNetworkPair(local: string, network: string): boolean {
  const localParts = parseVersion(local);
  const networkParts = parseVersion(network);
  return Boolean(
    localParts && networkParts
      && localParts[0] === networkParts[0]
      && localParts[1] === networkParts[1]
      && localParts[2] === networkParts[2] + 1,
  );
}
