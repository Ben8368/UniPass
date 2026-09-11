import {
  VaultCryptoError,
  VaultFormatError,
  type EncryptedVaultObject,
  type VaultObjectKind,
} from "./vault";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: KEY_BYTES * 8 }, true, ["encrypt", "decrypt"]);
}

export async function exportVaultKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return toBase64(raw);
}

export async function importVaultKey(value: string): Promise<CryptoKey> {
  try {
    const raw = fromBase64(value);
    if (raw.byteLength !== KEY_BYTES) throw new Error("bad key length");
    return await crypto.subtle.importKey("raw", asBufferSource(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    throw new VaultCryptoError();
  }
}

export async function encryptVaultObject(
  key: CryptoKey,
  id: string,
  kind: VaultObjectKind,
  payload: unknown,
  keyVersion = 1,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const aad = encoder.encode(`${id}\u0000${kind}\u0000${keyVersion}`);
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad },
      key,
      asBufferSource(encoder.encode(JSON.stringify(payload))),
    );
    return encoder.encode(JSON.stringify({
      formatVersion: 1,
      id,
      kind,
      keyVersion,
      algorithm: "AES-256-GCM",
      nonce: toBase64(nonce),
      ciphertext: toBase64(new Uint8Array(encrypted)),
    } satisfies EncryptedVaultObject));
  } catch {
    throw new VaultCryptoError();
  }
}

export async function decryptVaultObject<T>(key: CryptoKey, data: Uint8Array): Promise<{ envelope: EncryptedVaultObject; payload: T }> {
  try {
    const envelope = JSON.parse(decoder.decode(data)) as Partial<EncryptedVaultObject>;
    if (!isValidEnvelope(envelope)) throw new VaultFormatError();
    const nonce = fromBase64(envelope.nonce);
    const ciphertext = fromBase64(envelope.ciphertext);
    if (nonce.byteLength !== NONCE_BYTES || ciphertext.byteLength < 17) throw new VaultFormatError();
    const aad = encoder.encode(`${envelope.id}\u0000${envelope.kind}\u0000${envelope.keyVersion}`);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asBufferSource(nonce), additionalData: asBufferSource(aad) }, key, asBufferSource(ciphertext));
    const payload = JSON.parse(decoder.decode(decrypted)) as T;
    return { envelope: envelope as EncryptedVaultObject, payload };
  } catch (error) {
    if (error instanceof VaultFormatError) throw error;
    throw new VaultCryptoError();
  }
}

function isValidEnvelope(value: Partial<EncryptedVaultObject>): value is EncryptedVaultObject {
  const keys = Object.keys(value).sort().join(",");
  return keys === "algorithm,ciphertext,formatVersion,id,keyVersion,kind,nonce"
    && value.formatVersion === 1
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 160
    && (value.kind === "manifest" || value.kind === "app" || value.kind === "account" || value.kind === "credential")
    && Number.isInteger(value.keyVersion) && Number(value.keyVersion) > 0
    && value.algorithm === "AES-256-GCM"
    && typeof value.nonce === "string" && typeof value.ciphertext === "string";
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
