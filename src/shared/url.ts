import type { VaultTarget } from "./vault";

const SAME_ORIGIN_SPA_HOSTS = new Set(["jupiter.tec-do.com"]);
const JUPITER_ORIGIN = "https://jupiter.tec-do.com";
const UNIPASS_LOGIN_URL = "https://portal.unipass.top/login";
const FEISHU_AUTHORIZE_ORIGIN = "https://accounts.feishu.cn";
const FEISHU_AUTHORIZE_PATH = "/accounts/auth_login/oauth2/authorize";
const FEISHU_CLIENT_ID = "cli_aae6da4f6538dbed";
const TEC_IAM_REDIRECT_URL = "https://tec-iam.tec-do.com/portal/api/v1/login/feishu_oauth/gboh9uvzolazw62gmxojwaarust5qyvh";

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

export function normalizeWebDavUrl(value: string): string {
  const requested = value.trim();
  if (!requested) throw new Error("WebDAV 地址不能为空");
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    throw new Error("WebDAV 地址格式无效");
  }
  if (url.protocol !== "https:") throw new Error("为保护凭据安全，WebDAV 仅支持 HTTPS 地址");
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("WebDAV 地址只能包含 HTTPS 主机和路径");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

export function webDavPermissionOrigin(value: string): string {
  const url = new URL(normalizeWebDavUrl(value));
  return `${url.origin}/*`;
}

export function vaultTargetMatches(target: VaultTarget, currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const host = current.hostname.toLowerCase();
    const expectedHost = target.host.toLowerCase();
    const hostMatches = host === expectedHost || Boolean(target.includeSubdomains && host.endsWith(`.${expectedHost}`));
    if (target.scheme !== "https" || current.protocol !== "https:" || !hostMatches) return false;
    const prefix = normalizedPath(target.pathPrefix || "/");
    const currentPath = normalizedPath(current.pathname);
    return prefix === "/" || currentPath === prefix || currentPath.startsWith(`${prefix}/`);
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

export function isUniPassLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === new URL(UNIPASS_LOGIN_URL).origin
      && normalizedPath(url.pathname) === "/login"
      && !url.search;
  } catch {
    return false;
  }
}

export function isTrustedFeishuAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === FEISHU_AUTHORIZE_ORIGIN
      && normalizedPath(url.pathname) === FEISHU_AUTHORIZE_PATH
      && url.searchParams.get("response_type") === "code"
      && url.searchParams.get("client_id") === FEISHU_CLIENT_ID
      && url.searchParams.get("redirect_uri") === TEC_IAM_REDIRECT_URL
      && Boolean(url.searchParams.get("state"));
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
