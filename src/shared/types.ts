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
  | { type: "getPluginVersionSettings" }
  | { type: "setPluginVersionOverride"; version: string }
  | { type: "accountCatalog" }
  | { type: "listApps"; keyword: string }
  | { type: "accountsForApp"; appId: string | number }
  | { type: "appUrl"; appId: string | number }
  | { type: "credential"; accountId: string | number; fallbackUsername: string }
  | { type: "getJupiterKeepalive" }
  | { type: "setJupiterKeepalive"; enabled: boolean; appId?: string | number; accountId?: string | number; username?: string };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PluginVersionSettings {
  override: string;
  effective: string;
  source: "manual" | "store" | "fallback";
}

export interface JupiterKeepaliveSettings {
  enabled: boolean;
  appId?: string | number;
  accountId?: string | number;
  username?: string;
  lastSuccessAt?: number;
  lastError?: string;
}

export interface AccountListResult {
  appUrl: string;
  accounts: UniPassAccount[];
}

export interface AccountCatalogEntry {
  appId: string | number;
  appName: string;
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
