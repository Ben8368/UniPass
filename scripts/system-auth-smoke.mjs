import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function assertSystemAuthenticatorFlow(popup, extensionId) {
  const client = await popup.createCDPSession();
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: false,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  try {
    const result = await popup.evaluate(async () => {
      const base64Url = (value) => {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };
      const fromBase64Url = (value) => {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
        return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
      };
      const request = async (message) => {
        const response = await chrome.runtime.sendMessage(message);
        if (!response?.ok) throw new Error(response?.error || "System authenticator message failed");
        return response.data;
      };

      const registration = await request({ type: "beginSystemAuthenticator", purpose: "register" });
      const credential = await navigator.credentials.create({ publicKey: {
        challenge: fromBase64Url(registration.challenge),
        rp: { name: "UniPass" },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: "chrome-smoke",
          displayName: "UniPass Chrome Smoke",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { userVerification: "required", residentKey: "discouraged" },
        attestation: "none",
        timeout: 60_000,
      } });
      if (!(credential instanceof PublicKeyCredential)) throw new Error("Virtual authenticator did not create a credential");
      const registrationResponse = credential.response;
      const publicKey = registrationResponse.getPublicKey?.();
      const algorithm = registrationResponse.getPublicKeyAlgorithm?.();
      const registrationAuthenticatorData = registrationResponse.getAuthenticatorData?.();
      if (!publicKey || !registrationAuthenticatorData || algorithm !== -7) throw new Error("Virtual authenticator did not return a verifiable public key");
      await request({
        type: "saveSystemAuthenticator",
        attestation: {
          credentialId: base64Url(credential.rawId),
          clientDataJSON: base64Url(registrationResponse.clientDataJSON),
          authenticatorData: base64Url(registrationAuthenticatorData),
          publicKey: base64Url(publicKey),
          algorithm,
        },
      });
      const status = await request({ type: "getSystemAuthenticatorStatus" });
      const authentication = await request({ type: "beginSystemAuthenticator", purpose: "authenticate" });
      const assertionCredential = await navigator.credentials.get({ publicKey: {
        challenge: fromBase64Url(authentication.challenge),
        allowCredentials: [{ id: fromBase64Url(authentication.credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
      } });
      if (!(assertionCredential instanceof PublicKeyCredential)) throw new Error("Virtual authenticator did not return an assertion");
      const assertionResponse = assertionCredential.response;
      const assertion = {
        credentialId: base64Url(assertionCredential.rawId),
        clientDataJSON: base64Url(assertionResponse.clientDataJSON),
        authenticatorData: base64Url(assertionResponse.authenticatorData),
        signature: base64Url(assertionResponse.signature),
      };
      const token = await request({ type: "enableAdvancedMode", systemAuth: assertion });
      const replay = await chrome.runtime.sendMessage({ type: "enableAdvancedMode", systemAuth: assertion });
      return {
        status,
        token,
        replay,
        origin: location.origin,
        rpIdHash: base64Url(new Uint8Array(registrationAuthenticatorData).slice(0, 32)),
      };
    });
    assert.deepEqual(result.status, { configured: true });
    assert.match(result.token, /^[a-f0-9]{32}$/);
    assert.equal(result.origin, `chrome-extension://${extensionId}`);
    assert.equal(result.rpIdHash, createHash("sha256").update(result.origin).digest("base64url"));
    assert.equal(result.replay?.ok, false);
    assert.match(result.replay?.error ?? "", /请求已失效/);
  } finally {
    await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  }
}
