import { accountsForApp, credentialAvailableForAccount, listApps } from "../shared/api";
import type {
  AvailableAppsResult,
  CredentialAvailabilityResult,
  CredentialAvailabilityStatus,
} from "../shared/types";

const CACHE_KEY = "credentialAvailabilityCacheV1";
const CACHE_TTL_MS = 15 * 60 * 1000;
const CONCURRENCY = 4;

interface CacheEntry {
  status: Exclude<CredentialAvailabilityStatus, "error">;
  expiresAt: number;
}

export async function clearCredentialAvailabilityCache(): Promise<void> {
  await chrome.storage.session.remove(CACHE_KEY);
}

export async function credentialAvailability(
  accountIds: Array<string | number>,
  userScope: string,
): Promise<CredentialAvailabilityResult[]> {
  const uniqueAccountIds = accountIds.filter((accountId, index) =>
    accountIds.findIndex((candidate) => String(candidate) === String(accountId)) === index
  );
  if (uniqueAccountIds.length > 100) throw new Error("单次凭据检查的账号数量过多");

  const now = Date.now();
  const stored = await chrome.storage.session.get(CACHE_KEY);
  const cache = normalizeCache(stored[CACHE_KEY], now);
  let cacheChanged = false;

  const results = await mapWithConcurrency(
    uniqueAccountIds,
    CONCURRENCY,
    async (accountId): Promise<CredentialAvailabilityResult> => {
      const key = credentialAvailabilityCacheKey(userScope, accountId);
      const cached = cache[key];
      if (cached) return { accountId, status: cached.status };
      try {
        const status = await credentialAvailableForAccount(accountId) ? "available" : "empty";
        cache[key] = { status, expiresAt: now + CACHE_TTL_MS };
        cacheChanged = true;
        return { accountId, status };
      } catch (error) {
        return {
          accountId,
          status: "error" as const,
          error: error instanceof Error ? error.message : "凭据状态检查失败",
        };
      }
    },
  );

  if (cacheChanged) await chrome.storage.session.set({ [CACHE_KEY]: cache });
  return results;
}

export async function appsWithAvailableCredentials(
  keyword: string,
  userScope: string,
): Promise<AvailableAppsResult> {
  const apps = await listApps(keyword);
  const inspected = await mapWithConcurrency(apps, CONCURRENCY, async (app) => {
    let accounts;
    try {
      accounts = (await accountsForApp(app.id)).accounts;
    } catch {
      return { app, result: "directory-failure" as const };
    }

    const accountIds = accounts
      .map((account) => account.id ?? account.accountId ?? account.appAccountUserId)
      .filter((accountId): accountId is string | number => accountId != null);
    if (!accountIds.length) return { app, result: "empty" as const };

    let availability: CredentialAvailabilityResult[];
    try {
      availability = await credentialAvailability(accountIds, userScope);
    } catch {
      return { app, result: "verification-failure" as const };
    }
    if (availability.some((entry) => entry.status === "available")) return { app, result: "available" as const };
    if (availability.some((entry) => entry.status === "error")) return { app, result: "verification-failure" as const };
    return { app, result: "empty" as const };
  });

  return {
    apps: inspected.filter((entry) => entry.result === "available").map((entry) => entry.app),
    totalApps: apps.length,
    excludedEmptyCredentialApps: inspected.filter((entry) => entry.result === "empty").length,
    excludedVerificationFailureApps: inspected.filter((entry) => entry.result === "verification-failure").length,
    excludedDirectoryFailureApps: inspected.filter((entry) => entry.result === "directory-failure").length,
  };
}

export function credentialAvailabilityCacheKey(userScope: string, accountId: string | number): string {
  return JSON.stringify([userScope.trim(), String(accountId)]);
}

function normalizeCache(value: unknown, now: number): Record<string, CacheEntry> {
  if (!value || typeof value !== "object") return {};
  const cache: Record<string, CacheEntry> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Partial<CacheEntry>;
    if (
      (entry.status === "available" || entry.status === "empty") &&
      typeof entry.expiresAt === "number" &&
      entry.expiresAt > now
    ) {
      cache[key] = { status: entry.status, expiresAt: entry.expiresAt };
    }
  }
  return cache;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
