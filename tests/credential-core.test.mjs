import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const coreBytes = await readFile(new URL("../credential-core/target/wasm32-unknown-unknown/release/credential_core.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(coreBytes, {});
const core = instance.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function invoke(value, operation) {
  const input = encoder.encode(value);
  if (!input.length) return "";
  const inputPointer = core.c_a(input.length);
  assert.notEqual(inputPointer, 0);
  let outputPointer = 0;
  let outputLength = 0;
  try {
    new Uint8Array(core.memory.buffer, inputPointer, input.length).set(input);
    const packed = core[operation](inputPointer, input.length);
    outputPointer = Number(packed >> 32n);
    outputLength = Number(packed & 0xffff_ffffn);
    return outputPointer
      ? decoder.decode(new Uint8Array(core.memory.buffer, outputPointer, outputLength))
      : "";
  } finally {
    input.fill(0);
    core.c_f(inputPointer, input.length);
    if (outputPointer) core.c_f(outputPointer, outputLength);
  }
}

test("UniPass AES-ECB-PKCS7 vectors decrypt in the credential core", () => {
  assert.equal(invoke("qXQ6Dp8ayFvr6nTNcQFSTA==", "c_u"), "secret");
  assert.equal(
    invoke("Pmk6dj+RntHdqMPur13rffREbLL31Ehmd+QutyJOvXA=", "c_u"),
    "密碼-テスト-🔐",
  );
});

test("credential core rejects empty, malformed and invalid-padding UniPass ciphertext", () => {
  assert.equal(invoke("", "c_u"), "");
  assert.equal(invoke("not-base64", "c_u"), "");
  assert.equal(invoke("AAAAAAAAAAAAAAAAAAAAAA==", "c_u"), "");
});

test("Jupiter MD5 and DES-ECB-PKCS7 output remains bit-for-bit compatible", () => {
  assert.equal(
    invoke("jupiter-vector", "c_j"),
    "B62B2541A86858225F71CC0DCDEB18A7E85D2AC9C256100F2FA6060D73D617B21E18896ECEC80C84",
  );
  assert.equal(
    invoke("密碼-テスト-🔐", "c_j"),
    "B7274339ED75BE2F4F61B5350D1B71D723EE463D67762CD224E3C09B8A9ED9671E18896ECEC80C84",
  );
});
