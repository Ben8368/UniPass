import type { LocalUnlockMaterial } from "./local-unlock";

const DB_NAME = "unipass-vault-device-secrets-v1";
const STORE_NAME = "keys";
const DEVICE_KEY_ID = "device-key";
const FALLBACK_KEY = "unipass-vault-device-key-fallback";
const NONCE_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PersistentSecretEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
}

export async function sealPersistentMaterial(material: LocalUnlockMaterial): Promise<PersistentSecretEnvelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await deviceKey(true);
  if (!key) throw new Error("无法创建本地 WebDAV 设备密钥");
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      asBufferSource(encoder.encode(JSON.stringify(material))),
    );
    return { version: 1, algorithm: "AES-256-GCM", nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
  } finally {
    nonce.fill(0);
  }
}

export async function openPersistentMaterial(envelope: unknown): Promise<LocalUnlockMaterial> {
  if (!isEnvelope(envelope)) throw new Error("持久化 WebDAV 连接材料格式无效");
  const key = await deviceKey(false);
  if (!key) throw new Error("本地 WebDAV 设备密钥不存在");
  const nonce = fromBase64(envelope.nonce);
  const ciphertext = fromBase64(envelope.ciphertext);
  try {
    const parsed: unknown = JSON.parse(decoder.decode(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      asBufferSource(ciphertext),
    )));
    if (!isMaterial(parsed)) throw new Error("持久化 WebDAV 连接材料格式无效");
    return parsed;
  } catch {
    throw new Error("持久化 WebDAV 连接材料无法解密");
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
  }
}

async function deviceKey(create: boolean): Promise<CryptoKey | undefined> {
  if (typeof indexedDB !== "undefined") {
    const database = await openDatabase();
    try {
      const existing = await readKey(database);
      if (existing || !create) return existing;
      const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await writeKey(database, generated);
      return generated;
    } finally {
      database.close();
    }
  }
  const stored = (await chrome.storage.local.get(FALLBACK_KEY))[FALLBACK_KEY];
  if (typeof stored === "string" && stored) {
    return crypto.subtle.importKey("raw", asBufferSource(fromBase64(stored)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  if (!create) return undefined;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await chrome.storage.local.set({ [FALLBACK_KEY]: base64(raw) });
  try {
    return await crypto.subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地设备密钥"));
  });
}

function readKey(database: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DEVICE_KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error ?? new Error("无法读取本地设备密钥"));
  });
}

function writeKey(database: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(key, DEVICE_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("无法保存本地设备密钥"));
  });
}

function isEnvelope(value: unknown): value is PersistentSecretEnvelope {
  const item = value as PersistentSecretEnvelope;
  return Boolean(item && item.version === 1 && item.algorithm === "AES-256-GCM" && typeof item.nonce === "string" && typeof item.ciphertext === "string");
}

function isMaterial(value: unknown): value is LocalUnlockMaterial {
  const item = value as LocalUnlockMaterial;
  return Boolean(item && typeof item.username === "string" && item.username && typeof item.appPassword === "string" && item.appPassword && typeof item.vaultKey === "string" && item.vaultKey);
}

function base64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function asBufferSource(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
