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
  id?: string | number;
  userId?: string | number;
  user_id?: string | number;
  fullName?: string;
  nickName?: string;
  nickname?: string;
  name?: string;
  username?: string;
  email?: string;
}

export type PopupSessionUser = Omit<CurrentUser, "nickname">;

export type BackgroundRequest =
  | { type: "session" }
  | { type: "pageContext" }
  | { type: "pageTheme" }
  | { type: "openApp"; appId: string | number; userScope: string }
  | { type: "fillFromOverlay"; accountId: string | number; fallbackUsername: string; expectedAppUrl: string; userScope: string }
  | { type: "startUniPassLogin" }
  | { type: "completeUniPassLogin" }
  | { type: "getPluginVersionSettings" }
  | { type: "setPluginVersionOverride"; version: string }
  | { type: "accountCatalog"; userScope: string }
  | { type: "listApps"; keyword: string; userScope: string }
  | { type: "accountsForApp"; appId: string | number; userScope: string }
  | { type: "appUrl"; appId: string | number; userScope: string }
  | { type: "credentialAvailability"; accountIds: Array<string | number>; userScope: string }
  | { type: "credential"; accountId: string | number; fallbackUsername: string; userScope: string }
  | { type: "getJupiterKeepalive"; userScope: string }
  | { type: "setJupiterKeepalive"; enabled: boolean; userScope: string; appId?: string | number; accountId?: string | number; username?: string };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PluginVersionSettings {
  localBuildVersion: string;
  networkVersion: string;
  storeBaselineVersion: string;
  override: string;
  source: "store-baseline" | "manual";
}

export interface UniPassLoginStartResult {
  tabId: number;
}

export interface JupiterKeepaliveSettings {
  enabled: boolean;
  userScope?: string;
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

export interface AccountCatalogFailure {
  appId: string | number;
  appName: string;
  error: string;
}

export interface AccountCatalogResult {
  entries: AccountCatalogEntry[];
  failures: AccountCatalogFailure[];
  complete: boolean;
}

export type CredentialAvailabilityStatus = "available" | "empty" | "error";

export interface CredentialAvailabilityResult {
  accountId: string | number;
  status: CredentialAvailabilityStatus;
  error?: string;
}

export interface FillRequest {
  type: "fillCredentials";
  credential: Credential;
  expectedAppUrl: string;
  mode: "all" | "password";
}

export interface FillResult {
  ok: boolean;
  usernameFilled: boolean;
  passwordFilled: boolean;
  error?: string;
}

export type PageTheme = "light" | "dark";

export interface PageContext {
  tabId: number;
  url: string;
}
