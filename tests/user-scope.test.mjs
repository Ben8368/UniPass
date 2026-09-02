import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/user-scope.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { isStableUserScope, popupSessionUserFor, requireStableUserScope, userScopeFor } = await import(moduleUrl);

test("portal nickname is available to the Popup only as a transient tooltip value", () => {
  assert.deepEqual(
    popupSessionUserFor({ id: "user-1", username: "tester", nickName: "private nickname", nickname: "private nickname" }),
    { id: "user-1", username: "tester", nickName: "private nickname" },
  );
  assert.deepEqual(popupSessionUserFor({ username: "tester", nickname: "fallback nickname" }), {
    username: "tester",
    nickName: "fallback nickname",
  });
});

test("user scope prefers server IDs and falls back only to login identifiers", () => {
  assert.equal(userScopeFor({ id: "user-1", username: "same@example.com" }), "user:user-1");
  assert.equal(userScopeFor({ userId: 42, username: "same@example.com" }), "user:42");
  assert.equal(userScopeFor({ user_id: "user-2", username: "same@example.com" }), "user:user-2");
  assert.notEqual(userScopeFor({ id: "user-1" }), userScopeFor({ id: "user-2" }));
  assert.equal(userScopeFor({ username: "tester", email: "tester@example.com" }), "user:username:tester");
  assert.equal(userScopeFor({ email: "tester@example.com" }), "user:email:tester%40example.com");
  assert.equal(userScopeFor({ fullName: "同名用户", nickName: "同名用户" }), null);
  assert.equal(userScopeFor({ id: "a/b?c" }), "user:a%2Fb%3Fc");
  assert.equal(userScopeFor({ id: Number.NaN }), null);
  assert.equal(userScopeFor({ id: { unsafe: true } }), null);
});

test("only user-prefixed scopes are stable", () => {
  assert.equal(isStableUserScope("user:user-1"), true);
  assert.equal(isStableUserScope("popup:temporary"), false);
  assert.equal(isStableUserScope("user:two words"), false);
  assert.equal(isStableUserScope(""), false);
  assert.equal(requireStableUserScope("  user:user-1  "), "user:user-1");
  assert.throws(() => requireStableUserScope("popup:temporary"), /稳定用户标识/);
  assert.throws(() => requireStableUserScope(undefined), /稳定用户标识/);
});
