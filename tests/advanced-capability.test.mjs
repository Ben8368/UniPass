import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/background/advanced-capability.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { AdvancedCapabilityRegistry, ADVANCED_MODE_PORT_NAME } = await import(moduleUrl);

function fakePort(documentId) {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    name: ADVANCED_MODE_PORT_NAME,
    sender: { documentId },
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    sent: [],
    postMessage(message) { this.sent.push(message); },
    sendFromClient(message) { for (const listener of messageListeners) listener(message); },
    disconnect() {
      if (this.disconnected) return;
      this.disconnected = true;
      for (const listener of disconnectListeners) listener();
    },
  };
}

test("Advanced capability requires explicit handshake and follows the Port lifecycle", () => {
  let nextToken = 0;
  const registry = new AdvancedCapabilityRegistry(() => `token-${++nextToken}`);
  const senderA = { documentId: "document-a" };
  const senderB = { documentId: "document-b" };
  const token = registry.prepare(senderA);
  const port = fakePort("document-a");
  registry.attachPort(port);

  assert.throws(() => registry.require(senderA), /未启用高级模式/);
  port.sendFromClient({ type: "advancedModeHandshake", token });
  assert.equal(registry.require(senderA).port, port);
  assert.throws(() => registry.require(senderB), /未启用高级模式/);
  assert.deepEqual(port.sent, [{ type: "advancedModeEnabled" }]);

  port.disconnect();
  assert.throws(() => registry.require(senderA), /未启用高级模式/);
});

test("Invalid or unrelated connections never acquire Advanced capability", () => {
  const registry = new AdvancedCapabilityRegistry(() => "expected-token");
  const token = registry.prepare({ documentId: "document-a" });
  const wrongPort = fakePort("document-b");
  registry.attachPort(wrongPort);
  wrongPort.sendFromClient({ type: "advancedModeHandshake", token });
  assert.equal(wrongPort.sent.length, 0);
  assert.equal(wrongPort.disconnected, true);
  assert.throws(() => registry.require({ documentId: "document-b" }), /未启用高级模式/);
});

test("A new registry models Service Worker restart and fails closed", () => {
  const first = new AdvancedCapabilityRegistry(() => "token");
  const sender = { documentId: "document-a" };
  const port = fakePort("document-a");
  first.prepare(sender);
  first.attachPort(port);
  port.sendFromClient({ type: "advancedModeHandshake", token: "token" });
  assert.doesNotThrow(() => first.require(sender));

  const restarted = new AdvancedCapabilityRegistry(() => "token");
  assert.throws(() => restarted.require(sender), /未启用高级模式/);
});

