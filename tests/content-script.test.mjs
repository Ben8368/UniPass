import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let listener;
let listenerCount = 0;
const attributes = new Map();
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(value) { listener = value; listenerCount += 1; },
    },
  },
};
globalThis.document = {
  documentElement: {
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
  },
  querySelectorAll() {
    throw new Error("mismatched pages must be rejected before reading form fields");
  },
};
globalThis.location = { href: "https://example.com/app-b/login" };

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/content/content-script.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
await import(moduleUrl);

test("listener state is isolated from page DOM attributes and repeated injection", async () => {
  attributes.set("data-unipass-minimal-listener", "ready");
  const secondModuleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  await import(`${secondModuleUrl}#second-injection`);
  assert.equal(listenerCount, 1);
  attributes.delete("data-unipass-minimal-listener");
  const thirdModuleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  await import(`${thirdModuleUrl}#third-injection`);
  assert.equal(listenerCount, 1);
});

test("content script rejects credentials when the live document no longer matches the application", () => {
  assert.equal(typeof listener, "function");
  let response;
  listener({
    type: "fillCredentials",
    credential: { username: "tester", password: "" },
    expectedAppUrl: "https://example.com/app-a",
    mode: "all",
  }, {}, (value) => { response = value; });
  assert.deepEqual(response, {
    ok: false,
    usernameFilled: false,
    passwordFilled: false,
    error: "当前页面不属于所选应用，已取消填充",
  });
});

test("content script fills a semantically named username input even when it follows the password input", () => {
  class FakeInput {
    constructor({ type = "text", autocomplete = "", name = "", id = "", order = 0 } = {}) {
      this.type = type;
      this.autocomplete = autocomplete;
      this.name = name;
      this.id = id;
      this.order = order;
      this.disabled = false;
      this.readOnly = false;
      this._value = "";
      this.events = [];
      this.style = { visibility: "visible", display: "block" };
    }
    getAttribute(name) {
      return { type: this.type, autocomplete: this.autocomplete, name: this.name }[name] ?? null;
    }
    compareDocumentPosition(other) {
      return this.order < other.order ? 4 : 2;
    }
    getBoundingClientRect() { return { width: 240, height: 36 }; }
    dispatchEvent(event) { this.events.push(event.type); }
    focus() { this.focused = true; }
  }
  Object.defineProperty(FakeInput.prototype, "value", { get() { return this._value; }, set(value) { this._value = value; } });
  globalThis.HTMLInputElement = FakeInput;
  globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
  globalThis.getComputedStyle = (input) => input.style;
  globalThis.InputEvent = class { constructor(type) { this.type = type; } };
  globalThis.Event = class { constructor(type) { this.type = type; } };

  const password = new FakeInput({ type: "password", order: 1 });
  const username = new FakeInput({ type: "email", autocomplete: "username", name: "email", order: 2 });
  globalThis.location.href = "https://example.com/app-b/login";
  globalThis.document.querySelectorAll = (selector) => selector.includes("password") ? [password] : [username];

  let response;
  listener({
    type: "fillCredentials",
    credential: { username: "tester@example.com", password: "secret" },
    expectedAppUrl: "https://example.com/app-b",
    mode: "all",
  }, {}, (value) => { response = value; });

  assert.deepEqual(response, { ok: true, usernameFilled: true, passwordFilled: true });
  assert.equal(username.value, "tester@example.com");
  assert.equal(password.value, "secret");
  assert.deepEqual(username.events, ["input", "change"]);
  assert.deepEqual(password.events, ["input", "change"]);
  assert.equal(password.focused, true);
});
