import type { SystemAuthenticatorAssertion, SystemAuthenticatorAttestation } from "../../shared/types";

const SYSTEM_AUTHENTICATOR_KEY = "unipass-system-authenticator";
const SYSTEM_AUTH_PENDING_KEY = "unipass-system-auth-pending";
const SYSTEM_AUTH_TIMEOUT_MS = 60_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SystemAuthenticatorRecord {
  version: 1;
  credentialId: string;
  publicKey: string;
  algorithm: -7 | -257;
}

interface PendingSystemAuth {
  purpose: "register" | "authenticate";
  challenge: string;
  expiresAt: number;
}

export async function systemAuthenticatorStatus(): Promise<{ configured: boolean }> {
  return { configured: Boolean(await readRecord()) };
}

export async function beginSystemAuthenticator(purpose: PendingSystemAuth["purpose"]): Promise<{ challenge: string; credentialId?: string }> {
  const record = await readRecord();
  if (purpose === "authenticate" && !record) throw new Error("尚未设置系统验证，请先设置系统验证或使用备用 PIN");
  const challenge = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await chrome.storage.session.set({ [SYSTEM_AUTH_PENDING_KEY]: { purpose, challenge, expiresAt: Date.now() + SYSTEM_AUTH_TIMEOUT_MS } satisfies PendingSystemAuth });
  return { challenge, ...(purpose === "authenticate" && record ? { credentialId: record.credentialId } : {}) };
}

export async function saveSystemAuthenticator(attestation: SystemAuthenticatorAttestation): Promise<void> {
  const pending = await consumePending("register");
  const clientData = verifyClientData(attestation.clientDataJSON, pending, "webauthn.create");
  const authenticatorData = fromBase64Url(attestation.authenticatorData);
  requireUserVerification(authenticatorData);
  const publicKey = fromBase64Url(attestation.publicKey);
  if (!attestation.credentialId || !publicKey.byteLength || (attestation.algorithm !== -7 && attestation.algorithm !== -257)) {
    throw new Error("系统验证器注册信息无效");
  }
  await importPublicKey(publicKey, attestation.algorithm);
  await chrome.storage.local.set({
    [SYSTEM_AUTHENTICATOR_KEY]: {
      version: 1,
      credentialId: attestation.credentialId,
      publicKey: attestation.publicKey,
      algorithm: attestation.algorithm,
    } satisfies SystemAuthenticatorRecord,
  });
  void clientData;
}

export async function verifySystemAuthenticator(assertion: SystemAuthenticatorAssertion): Promise<void> {
  const pending = await consumePending("authenticate");
  const record = await readRecord();
  if (!record || assertion.credentialId !== record.credentialId) throw new Error("系统验证器与当前扩展不匹配");
  const clientData = verifyClientData(assertion.clientDataJSON, pending, "webauthn.get");
  const authenticatorData = fromBase64Url(assertion.authenticatorData);
  requireUserVerification(authenticatorData);
  const publicKey = fromBase64Url(record.publicKey);
  const key = await importPublicKey(publicKey, record.algorithm);
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", asBufferSource(clientData.raw)));
  const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength);
  signedData.set(authenticatorData, 0);
  signedData.set(clientDataHash, authenticatorData.byteLength);
  const signature = record.algorithm === -7 ? derOrRawEcdsaSignature(fromBase64Url(assertion.signature)) : fromBase64Url(assertion.signature);
  const valid = await crypto.subtle.verify(
    record.algorithm === -7 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" },
    key,
    asBufferSource(signature),
    asBufferSource(signedData),
  );
  if (!valid) throw new Error("系统验证失败");
}

async function readRecord(): Promise<SystemAuthenticatorRecord | undefined> {
  const value = (await chrome.storage.local.get(SYSTEM_AUTHENTICATOR_KEY))[SYSTEM_AUTHENTICATOR_KEY];
  return isRecord(value) && value.version === 1 && typeof value.credentialId === "string" && typeof value.publicKey === "string" && (value.algorithm === -7 || value.algorithm === -257)
    ? value as unknown as SystemAuthenticatorRecord
    : undefined;
}

async function consumePending(purpose: PendingSystemAuth["purpose"]): Promise<PendingSystemAuth> {
  const value = (await chrome.storage.session.get(SYSTEM_AUTH_PENDING_KEY))[SYSTEM_AUTH_PENDING_KEY];
  await chrome.storage.session.set({ [SYSTEM_AUTH_PENDING_KEY]: null });
  if (!isPending(value) || value.purpose !== purpose || value.expiresAt < Date.now()) throw new Error("系统验证请求已失效，请重试");
  return value;
}

function verifyClientData(encoded: string, pending: PendingSystemAuth, expectedType: "webauthn.create" | "webauthn.get"): { raw: Uint8Array; parsed: Record<string, unknown> } {
  const raw = fromBase64Url(encoded);
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(raw)); } catch { throw new Error("系统验证响应格式无效"); }
  if (!isRecord(parsed) || parsed.type !== expectedType || parsed.challenge !== pending.challenge || parsed.origin !== extensionOrigin()) throw new Error("系统验证响应不匹配");
  return { raw, parsed };
}

function requireUserVerification(authenticatorData: Uint8Array): void {
  if (authenticatorData.byteLength < 37 || (authenticatorData[32] & 0x04) === 0) throw new Error("系统验证未完成用户验证");
}

async function importPublicKey(publicKey: Uint8Array, algorithm: -7 | -257): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    asBufferSource(publicKey),
    algorithm === -7 ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function extensionOrigin(): string {
  return new URL(chrome.runtime.getURL("")).origin;
}

function derOrRawEcdsaSignature(value: Uint8Array): Uint8Array {
  if (value.byteLength === 64) return value;
  if (value[0] !== 0x30) throw new Error("系统验证签名格式无效");
  let index = 2;
  if (value[1] & 0x80) index += (value[1] & 0x7f) - 1;
  if (value[index++] !== 0x02) throw new Error("系统验证签名格式无效");
  const rLength = value[index++];
  const r = value.slice(index, index + rLength); index += rLength;
  if (value[index++] !== 0x02) throw new Error("系统验证签名格式无效");
  const sLength = value[index++];
  const s = value.slice(index, index + sLength);
  if (!r.byteLength || !s.byteLength) throw new Error("系统验证签名格式无效");
  const result = new Uint8Array(64);
  result.set(r.slice(-32), 32 - Math.min(32, r.byteLength));
  result.set(s.slice(-32), 64 - Math.min(32, s.byteLength));
  return result;
}

function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function fromBase64Url(value: string): Uint8Array { const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="); return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)); }
function asBufferSource(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isPending(value: unknown): value is PendingSystemAuth { return isRecord(value) && (value.purpose === "register" || value.purpose === "authenticate") && typeof value.challenge === "string" && typeof value.expiresAt === "number"; }
