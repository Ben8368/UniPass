import type { SystemAuthenticatorAssertion, SystemAuthenticatorAttestation } from "../shared/types";
import { send } from "./bridge";

interface SystemAuthResponse extends AuthenticatorResponse {
  getPublicKey?: () => ArrayBuffer | null;
  getPublicKeyAlgorithm?: () => number;
  getAuthenticatorData?: () => ArrayBuffer;
}

export class SystemAuthUnavailableError extends Error {
  constructor(message = "当前浏览器没有可用的系统验证，请设置备用 PIN") {
    super(message);
    this.name = "SystemAuthUnavailableError";
  }
}

export async function hasSystemAuthenticator(): Promise<boolean> {
  return (await send<{ configured: boolean }>({ type: "getSystemAuthenticatorStatus" })).configured;
}

export async function registerSystemAuthenticator(pin = ""): Promise<void> {
  if (!isWebAuthnAvailable()) throw new SystemAuthUnavailableError();
  let replacementAuth: SystemAuthenticatorAssertion | undefined;
  let replacementPin: string | undefined;
  if (await hasSystemAuthenticator()) {
    try {
      replacementAuth = await authenticateSystemAuthenticator();
    } catch (error) {
      if (!pin) throw new SystemAuthUnavailableError(`当前系统验证未完成；如需替换，请输入备用 PIN：${error instanceof Error ? error.message : "请重试"}`);
      replacementPin = pin;
    }
  }
  const { challenge } = await send<{ challenge: string }>({ type: "beginSystemAuthenticator", purpose: "register", replacementAuth, replacementPin });
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: fromBase64Url(challenge),
    rp: { name: "UniPass" },
    user: { id: crypto.getRandomValues(new Uint8Array(16)).buffer, name: "unipass-local-user", displayName: "UniPass 本机验证" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { userVerification: "required", residentKey: "discouraged" },
    attestation: "none",
    timeout: 60_000,
  } });
  if (!(credential instanceof PublicKeyCredential)) throw new SystemAuthUnavailableError("系统验证未完成，请重试或设置备用 PIN");
  const response = credential.response as SystemAuthResponse;
  const publicKey = response.getPublicKey?.();
  const algorithm = response.getPublicKeyAlgorithm?.();
  const authenticatorData = response.getAuthenticatorData?.();
  if (!publicKey || !authenticatorData || (algorithm !== -7 && algorithm !== -257)) throw new SystemAuthUnavailableError("当前浏览器未返回可验证的系统凭据，请设置备用 PIN");
  const attestation: SystemAuthenticatorAttestation = {
    credentialId: base64Url(credential.rawId),
    clientDataJSON: base64Url(response.clientDataJSON),
    authenticatorData: base64Url(authenticatorData),
    publicKey: base64Url(publicKey),
    algorithm,
  };
  await send<void>({ type: "saveSystemAuthenticator", attestation });
}

export async function authenticateSystemAuthenticator(): Promise<SystemAuthenticatorAssertion> {
  if (!isWebAuthnAvailable()) throw new SystemAuthUnavailableError();
  const { challenge, credentialId } = await send<{ challenge: string; credentialId?: string }>({ type: "beginSystemAuthenticator", purpose: "authenticate" });
  if (!credentialId) throw new SystemAuthUnavailableError("尚未设置系统验证，请先设置系统验证或使用备用 PIN");
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: fromBase64Url(challenge),
    allowCredentials: [{ id: fromBase64Url(credentialId), type: "public-key" }],
    userVerification: "required",
    timeout: 60_000,
  } });
  if (!(credential instanceof PublicKeyCredential)) throw new SystemAuthUnavailableError("系统验证未完成，请重试或输入备用 PIN");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: base64Url(credential.rawId),
    clientDataJSON: base64Url(response.clientDataJSON),
    authenticatorData: base64Url(response.authenticatorData),
    signature: base64Url(response.signature),
  };
}

function isWebAuthnAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.credentials?.create === "function" && typeof PublicKeyCredential !== "undefined";
}

function base64Url(value: ArrayBuffer | ArrayBufferView): string {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}
