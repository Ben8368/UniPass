import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const values = {};
const executed = [];
const createdTabs = [];
const updatedTabs = [];

globalThis.chrome = {
  storage: {
    session: {
      async get(key) { return { [key]: values[key] }; },
      async set(items) { Object.assign(values, items); },
      async remove(key) { delete values[key]; },
    },
  },
  tabs: {
    async query() { return []; },
    async create(details) { createdTabs.push(details); return { id: 7, status: "loading", url: "https://portal.unipass.top/login", active: details.active }; },
    async update(id, details) { updatedTabs.push({ id, details }); return { id, status: "complete", url: "https://portal.unipass.top/login", active: details.active }; },
    async get(id) { return { id, status: "complete", url: "https://portal.unipass.top/login" }; },
  },
  scripting: {
    async executeScript(details) {
      executed.push(details);
      return [{ result: true }];
    },
  },
};

const buildResult = await build({
  entryPoints: [fileURLToPath(new URL("../src/background/unipass-login.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const source = buildResult.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const login = await import(moduleUrl);

const trustedAuthorizationUrl = "https://accounts.feishu.cn/accounts/auth_login/oauth2/authorize?response_type=code&client_id=cli_aae6da4f6538dbed&state=random-state&redirect_uri=https%3A%2F%2Ftec-iam.tec-do.com%2Fportal%2Fapi%2Fv1%2Flogin%2Ffeishu_oauth%2Fgboh9uvzolazw62gmxojwaarust5qyvh";

function nextTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("user-triggered login starts in a background tab before the portal page completes and clears state after the trusted authorization click", async () => {
  assert.deepEqual(await login.startUniPassLogin(), { tabId: 7 });
  assert.deepEqual(createdTabs, [{ url: "https://portal.unipass.top/login", active: false }]);
  await nextTask();
  assert.equal(executed.length, 1);
  assert.equal(values.pendingUniPassLogin.phase, "feishu");
  assert.equal(executed[0].injectImmediately, true);
  assert.equal(executed[0].target.tabId, 7);

  await login.processUniPassLoginTab(7, trustedAuthorizationUrl);
  assert.equal(executed.length, 2);
  assert.equal(executed[1].injectImmediately, true);
  assert.equal(values.pendingUniPassLogin, undefined);
});

test("injected login functions do not depend on the service worker module scope", async () => {
  const portalFunction = executed[0]?.func;
  const authorizationFunction = executed[1]?.func;
  assert.equal(typeof portalFunction, "function");
  assert.equal(typeof authorizationFunction, "function");

  const portalContext = {
    location: { origin: "https://portal.unipass.top", pathname: "/login", search: "" },
    document: {
      querySelectorAll() {
        return [{ textContent: "钛动科技", disabled: false, offsetParent: {}, click() { this.clicked = true; } }];
      },
    },
    Date,
    Promise,
    setTimeout,
  };
  assert.equal(await vm.runInNewContext("(" + portalFunction.toString() + ")()", portalContext), true);

  const authorizationContext = {
    location: { href: trustedAuthorizationUrl },
    document: {
      body: { innerText: "钛动身份认证中心（Tec-IAM） 获取用户身份标识" },
      querySelectorAll() {
        return [{ textContent: "授权", disabled: false, offsetParent: {}, click() { this.clicked = true; } }];
      },
    },
    Date,
    Promise,
    setTimeout,
    URL,
  };
  assert.equal(await vm.runInNewContext("(" + authorizationFunction.toString() + ")()", authorizationContext), true);
});

test("injected login functions keep their MutationObserver logic self-contained", async () => {
  assert.match(executed[0].func.toString(), /MutationObserver/);
  assert.match(executed[1].func.toString(), /MutationObserver/);
  assert.match(executed[0].func.toString(), /document\.documentElement \?\? document/);
  assert.match(executed[1].func.toString(), /document\.documentElement \?\? document/);
  assert.doesNotMatch(executed[0].func.toString(), /clickWhenReady/);
  assert.doesNotMatch(executed[1].func.toString(), /clickWhenReady/);
});

test("an in-progress login remains in the background when requested again", async () => {
  assert.deepEqual(await login.startUniPassLogin(), { tabId: 7 });
  assert.deepEqual(await login.startUniPassLogin(), { tabId: 7 });
  assert.deepEqual(updatedTabs, []);
  await login.clearUniPassLoginForTab(7);
});

test("login helper starts while trusted pages are loading", async () => {
  const serviceWorker = await readFile(new URL("../src/background/service-worker.ts", import.meta.url), "utf8");
  assert.match(serviceWorker, /changeInfo\.status === "loading" \|\| changeInfo\.status === "complete"/);
});

test("login tracking stops when the tab leaves the fixed authentication origins", async () => {
  assert.deepEqual(await login.startUniPassLogin(), { tabId: 7 });
  await nextTask();
  await login.processUniPassLoginTab(7, "https://evil.example/login");
  assert.equal(values.pendingUniPassLogin, undefined);
});
