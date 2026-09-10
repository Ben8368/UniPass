import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCredentialCore } from "./build-wasm.mjs";

const root = resolve(import.meta.dirname, "..");
const targetRoot = await mkdtemp(join(tmpdir(), "unipass-harden-diversity-"));
const vectors = {
  availability: ["qXQ6Dp8ayFvr6nTNcQFSTA==", "2+AUDpl4nB2/MyEs+o1Uwg=="],
  decrypt: "qXQ6Dp8ayFvr6nTNcQFSTA==",
  jupiter: "qXQ6Dp8ayFvr6nTNcQFSTA==",
};
const expected = {
  decrypt: "secret",
  jupiter: "0A98F2E95077EA703D622EF7F27392D9FC95129137121CA21F52D036DFCE81F81E18896ECEC80C84",
};

function invoke(core, value, operation) {
  const input = new TextEncoder().encode(value);
  const inputPointer = core.c_a(input.length);
  assert.notEqual(inputPointer, 0);
  let outputPointer = 0;
  let outputLength = 0;
  try {
    new Uint8Array(core.memory.buffer, inputPointer, input.length).set(input);
    const packed = core[operation](inputPointer, input.length);
    outputPointer = Number(packed >> 32n);
    outputLength = Number(packed & 0xffff_ffffn);
    return outputPointer ? new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(core.memory.buffer, outputPointer, outputLength)) : "";
  } finally {
    input.fill(0);
    core.c_f(inputPointer, input.length);
    if (outputPointer) core.c_f(outputPointer, outputLength);
  }
}

try {
  const hashes = [];
  for (const [index, seed] of ["diversity-a", "diversity-b"].entries()) {
    const targetDirectory = join(targetRoot, `target-${index}`);
    const output = join(targetRoot, `credential-${index}.wasm`);
    await buildCredentialCore(output, { seed, targetDirectory });
    const bytes = await readFile(output);
    hashes.push(createHash("sha256").update(bytes).digest("hex"));
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const core = instance.exports;
    assert.equal(invoke(core, vectors.decrypt, "c_u"), expected.decrypt);
    assert.equal(invoke(core, vectors.jupiter, "c_k"), expected.jupiter);
    assert.equal((() => {
      const input = new TextEncoder().encode(vectors.availability[0]);
      const pointer = core.c_a(input.length);
      new Uint8Array(core.memory.buffer, pointer, input.length).set(input);
      try { return core.c_v(pointer, input.length); } finally { input.fill(0); core.c_f(pointer, input.length); }
    })(), 2);
    assert.equal((() => {
      const input = new TextEncoder().encode(vectors.availability[1]);
      const pointer = core.c_a(input.length);
      new Uint8Array(core.memory.buffer, pointer, input.length).set(input);
      try { return core.c_v(pointer, input.length); } finally { input.fill(0); core.c_f(pointer, input.length); }
    })(), 1);
  }
  assert.notEqual(hashes[0], hashes[1]);
  console.log(`Hardened diversity GREEN: WASM A ${hashes[0]} != WASM B ${hashes[1]}; protocol vectors identical`);
} finally {
  await rm(targetRoot, { recursive: true, force: true });
}
