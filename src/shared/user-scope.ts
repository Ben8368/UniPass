import type { CurrentUser, PopupSessionUser } from "./types";

export function popupSessionUserFor(user: CurrentUser): PopupSessionUser {
  const { nickname, ...popupUser } = user;
  if (!popupUser.nickName?.trim() && nickname?.trim()) return { ...popupUser, nickName: nickname };
  return popupUser;
}

export function userScopeFor(user: CurrentUser): string | null {
  for (const candidate of [user.id, user.userId, user.user_id]) {
    if (typeof candidate !== "string" && typeof candidate !== "number") continue;
    if (typeof candidate === "number" && !Number.isFinite(candidate)) continue;
    const value = String(candidate).trim();
    if (value) return `user:${encodeURIComponent(value)}`;
  }

  for (const [kind, candidate] of [["username", user.username], ["email", user.email]] as const) {
    const value = candidate?.trim();
    if (value) return `user:${kind}:${encodeURIComponent(value)}`;
  }
  return null;
}

export function isStableUserScope(scope: string): boolean {
  return /^user:\S+$/.test(scope.trim());
}

export function requireStableUserScope(scope: string | undefined): string {
  const normalized = typeof scope === "string" ? scope.trim() : "";
  if (!isStableUserScope(normalized)) {
    throw new Error("UniPass 会话缺少稳定用户标识，请重新打开弹窗");
  }
  return normalized;
}
