import assert from "node:assert/strict";
import { test } from "node:test";
import { validateExternalUserId } from "./app-users.js";

test("validateExternalUserId accepts safe usernames", () => {
  assert.equal(validateExternalUserId("demo-user"), "demo-user");
  assert.equal(validateExternalUserId("rick.staa"), "rick.staa");
});

test("validateExternalUserId rejects empty", () => {
  assert.throws(() => validateExternalUserId(""), /externalUserId/);
});
