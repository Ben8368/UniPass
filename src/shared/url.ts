const SAME_ORIGIN_SPA_HOSTS = new Set(["jupiter.tec-do.com"]);
const JUPITER_ORIGIN = "https://jupiter.tec-do.com";

export function normalizeTargetUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (!keepsQueryForMatching(url.hostname)) url.search = "";
  return url.toString();
}

export function appUrlMatches(appUrl: string, currentUrl: string): boolean {
  try {
    const app = new URL(appUrl);
    const current = new URL(currentUrl);
    if (app.protocol !== "https:" || current.protocol !== "https:" || app.origin !== current.origin) return false;
    if (SAME_ORIGIN_SPA_HOSTS.has(app.hostname.toLowerCase())) return true;
    if (normalizeTargetUrl(appUrl) === normalizeTargetUrl(currentUrl)) return true;
    if (keepsQueryForMatching(app.hostname) || keepsQueryForMatching(current.hostname)) return false;

    const appPath = normalizedPath(app.pathname);
    const currentPath = normalizedPath(current.pathname);
    return appPath === "/" || currentPath === appPath || currentPath.startsWith(`${appPath}/`);
  } catch {
    return false;
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isJupiterUrl(value: string): boolean {
  try {
    return new URL(value).origin === JUPITER_ORIGIN;
  } catch {
    return false;
  }
}

function normalizedPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function keepsQueryForMatching(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  return lowerHostname.includes("huaban") || lowerHostname.includes("gaoding");
}
