import { VaultCryptoError } from "../../shared/vault";

const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const GLOBAL_PIN_MARKER = "unipass-global-pin-v1";

export interface LocalUnlockMaterial {
  username: string;
  appPassword: string;
  vaultKey: string;
}

export interface LocalUnlockEnvelope {
  version: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export async function sealLocalUnlockMaterial(password: string, material: LocalUnlockMaterial): Promise<LocalUnlockEnvelope> {
  if (!password) throw new Error("本地解锁密码不能为空");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await derive(password, salt, ["encrypt"]);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBufferSource(nonce) }, key, asBufferSource(encoder.encode(JSON.stringify(material))));
    return { version: 1, kdf: "PBKDF2-SHA-256", iterations: ITERATIONS, salt: base64(salt), nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
  } finally {
    zero(salt); zero(nonce);
  }
}

export async function openLocalUnlockMaterial(password: string, envelope: unknown): Promise<LocalUnlockMaterial> {
  if (!password || !isEnvelope(envelope)) throw new VaultCryptoError();
  const salt = fromBase64(envelope.salt);
  const nonce = fromBase64(envelope.nonce);
  const ciphertext = fromBase64(envelope.ciphertext);
  try {
    const key = await derive(password, salt, ["decrypt"]);
    const parsed: unknown = JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: asBufferSource(nonce) }, key, asBufferSource(ciphertext))));
    if (!isMaterial(parsed)) throw new VaultCryptoError();
    return parsed;
  } catch {
    throw new VaultCryptoError();
  } finally { zero(salt); zero(nonce); zero(ciphertext); }
}

export async function sealGlobalPin(pin: string): Promise<LocalUnlockEnvelope> {
  return sealLocalUnlockMaterial(pin, { username: GLOBAL_PIN_MARKER, appPassword: GLOBAL_PIN_MARKER, vaultKey: GLOBAL_PIN_MARKER });
}

export async function openGlobalPin(pin: string, envelope: unknown): Promise<void> {
  const material = await openLocalUnlockMaterial(pin, envelope);
  if (material.username !== GLOBAL_PIN_MARKER || material.appPassword !== GLOBAL_PIN_MARKER || material.vaultKey !== GLOBAL_PIN_MARKER) throw new VaultCryptoError();
}

export function validateGlobalPin(pin: string): void {
  if (!/^[0-9]{4,32}$/.test(pin)) throw new Error("全局 PIN 必须是 4 至 32 位数字");
}

function isEnvelope(value: unknown): value is LocalUnlockEnvelope {
  const item = value as LocalUnlockEnvelope;
  return Boolean(item && item.version === 1 && item.kdf === "PBKDF2-SHA-256" && item.iterations === ITERATIONS && typeof item.salt === "string" && typeof item.nonce === "string" && typeof item.ciphertext === "string");
}
function isMaterial(value: unknown): value is LocalUnlockMaterial {
  const item = value as LocalUnlockMaterial;
  return Boolean(item && typeof item.username === "string" && item.username && typeof item.appPassword === "string" && item.appPassword && typeof item.vaultKey === "string" && item.vaultKey);
}
async function derive(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: asBufferSource(salt), iterations: ITERATIONS }, source, { name: "AES-GCM", length: 256 }, false, usages);
}
function base64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function zero(bytes: Uint8Array): void { bytes.fill(0); }
function asBufferSource(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
