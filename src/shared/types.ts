export interface UniPassApp {
  id: string | number;
  name?: string;
  appName?: string;
  favorite?: boolean;
}

export interface UniPassAccount {
  id?: string | number;
  accountId?: string | number;
  appAccountUserId?: string | number;
  account?: string;
  phoneNumber?: string;
  email?: string;
  remark?: string;
  topPriority?: boolean;
}

export interface Credential {
  username: string;
  password: string;
}

export interface CurrentUser {
  fullName?: string;
  nickName?: string;
  name?: string;
  username?: string;
  email?: string;
}

export type BackgroundRequest =
  | { type: "session" }
  | { type: "accountsForUrl"; url: string }
  | { type: "listApps"; keyword: string }
  | { type: "accountsForApp"; appId: string | number }
  | { type: "credential"; accountId: string | number; fallbackUsername: string };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface AccountListResult {
  appUrl: string;
  accounts: UniPassAccount[];
}

export interface FillRequest {
  type: "fillCredentials";
  credential: Credential;
  mode: "all" | "password";
}

export interface FillResult {
  ok: boolean;
  usernameFilled: boolean;
  passwordFilled: boolean;
  error?: string;
}
