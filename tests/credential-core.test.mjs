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

function available(value) {
  const input = encoder.encode(value);
  if (!input.length) return 0;
  const inputPointer = core.c_a(input.length);
  assert.notEqual(inputPointer, 0);
  try {
    new Uint8Array(core.memory.buffer, inputPointer, input.length).set(input);
    return core.c_v(inputPointer, input.length);
  } finally {
    input.fill(0);
    core.c_f(inputPointer, input.length);
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

test("credential availability stays in WASM and distinguishes false from error", () => {
  assert.equal(available("qXQ6Dp8ayFvr6nTNcQFSTA=="), 2);
  assert.equal(available("2+AUDpl4nB2/MyEs+o1Uwg=="), 1);
  assert.equal(available("AAAAAAAAAAAAAAAAAAAAAA=="), 0);
  assert.equal(available("not-base64"), 0);
});

test("Jupiter combined ciphertext transform remains bit-for-bit compatible", () => {
  assert.equal(
    invoke("qXQ6Dp8ayFvr6nTNcQFSTA==", "c_k"),
    "0A98F2E95077EA703D622EF7F27392D9FC95129137121CA21F52D036DFCE81F81E18896ECEC80C84",
  );
  assert.equal(
    invoke("Pmk6dj+RntHdqMPur13rffREbLL31Ehmd+QutyJOvXA=", "c_k"),
    "B7274339ED75BE2F4F61B5350D1B71D723EE463D67762CD224E3C09B8A9ED9671E18896ECEC80C84",
  );
});

test("invalid ABI pointers are rejected without a WASM trap", () => {
  assert.equal(core.c_a(0), 0);
  assert.equal(core.c_a(64 * 1024 + 1), 0);
  assert.equal(core.c_v(0, 1), 0);
  assert.equal(core.c_u(0, 1), 0n);
  assert.equal(core.c_k(0, 1), 0n);
  assert.doesNotThrow(() => core.c_f(1, 1));
});

test("repeated combined calls release their input and output allocations", () => {
  invoke("qXQ6Dp8ayFvr6nTNcQFSTA==", "c_k");
  const before = core.memory.buffer.byteLength;
  for (let index = 0; index < 1000; index += 1) {
    assert.equal(
      invoke("qXQ6Dp8ayFvr6nTNcQFSTA==", "c_k"),
      "0A98F2E95077EA703D622EF7F27392D9FC95129137121CA21F52D036DFCE81F81E18896ECEC80C84",
    );
  }
  const after = core.memory.buffer.byteLength;
  assert.ok(after - before <= 64 * 1024);
});
