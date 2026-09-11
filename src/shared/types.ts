import type { AccountRef, AppRef, VaultAccount, VaultApp, VaultTarget } from "./vault";

export interface UniPassApp {
  id: string | number;
  name?: string;
  appName?: string;
  favorite?: boolean;
  vaultId?: string;
  appRef?: AppRef;
  targets?: VaultTarget[];
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
  vaultId?: string;
  appId?: string;
  accountRef?: AccountRef;
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
  | { type: "openApp"; appId: string | number; vaultId?: string; userScope: string }
  | { type: "fillFromOverlay"; accountId: string | number; accountRef?: AccountRef; expectedAppUrl: string; userScope: string }
  | { type: "fillFromPopup"; tabId: number; accountId: string | number; accountRef?: AccountRef; expectedAppUrl: string; userScope: string }
  | { type: "enableAdvancedMode" }
  | { type: "startUniPassLogin" }
  | { type: "completeUniPassLogin" }
  | { type: "getPluginVersionSettings" }
  | { type: "setPluginVersionOverride"; version: string }
  | { type: "readSelfBuildFile"; path: string }
  | { type: "accountCatalog"; userScope: string }
  | { type: "listApps"; keyword: string; userScope: string }
  | { type: "accountsForApp"; appId: string | number; vaultId?: string; userScope: string }
  | { type: "appUrl"; appId: string | number; vaultId?: string; userScope: string }
  | { type: "credentialAvailability"; accountIds: Array<string | number>; accountRefs?: AccountRef[]; userScope: string }
  | { type: "revealCredential"; accountId: string | number; accountRef?: AccountRef; userScope: string }
  | { type: "getJupiterKeepalive"; userScope: string }
  | { type: "setJupiterKeepalive"; enabled: boolean; userScope: string; appId?: string | number; accountId?: string | number; username?: string }
  | { type: "listVaultProfiles" }
  | { type: "testWebDavConnection"; name: string; endpoint: string; username: string; appPassword: string }
  | { type: "saveWebDavVault"; vaultId?: string; name: string; endpoint: string; username: string; appPassword: string }
  | { type: "removeVault"; vaultId: string }
  | { type: "vaultCatalog" }
  | { type: "createVaultApp"; vaultId: string; app: Omit<VaultApp, "id" | "vaultId"> }
  | { type: "updateVaultApp"; vaultId: string; app: VaultApp }
  | { type: "deleteVaultApp"; vaultId: string; appId: string }
  | { type: "createVaultAccount"; vaultId: string; account: Omit<VaultAccount, "id" | "vaultId" | "credentialId"> & { password: string } }
  | { type: "updateVaultAccount"; vaultId: string; account: VaultAccount }
  | { type: "deleteVaultAccount"; vaultId: string; accountId: string }
  | { type: "updateVaultCredential"; vaultId: string; accountId: string; credential: Credential };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PluginVersionSettings {
  localBuildVersion: string;
  networkVersion: string;
  storeBaselineVersion: string;
  override: string;
  source: "built-in" | "manual";
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
  vaultId?: string;
}

export interface AccountCatalogEntry {
  appId: string | number;
  appName: string;
  appUrl: string;
  accounts: UniPassAccount[];
  vaultId?: string;
  targets?: VaultTarget[];
}

export interface AccountCatalogFailure {
  appId: string | number;
  appName: string;
  error: string;
  vaultId?: string;
}

export interface AccountCatalogResult {
  entries: AccountCatalogEntry[];
  failures: AccountCatalogFailure[];
  complete: boolean;
}

export type CredentialAvailabilityStatus = "available" | "empty" | "error";

export interface CredentialAvailabilityResult {
  accountId: string | number;
  accountRef?: AccountRef;
  status: CredentialAvailabilityStatus;
  error?: string;
}

export interface AvailableAppsResult {
  apps: UniPassApp[];
  totalApps: number;
  excludedEmptyCredentialApps: number;
  excludedVerificationFailureApps: number;
  excludedDirectoryFailureApps: number;
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
