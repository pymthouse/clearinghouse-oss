import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { generateSecret, hashSecret, verifySecret } from "./crypto.js";

test("hashSecret round-trips through verifySecret", () => {
  const secret = generateSecret();
  const hash = hashSecret(secret);
  assert.ok(hash.startsWith("scrypt:"));
  assert.equal(verifySecret(secret, hash), true);
  assert.equal(verifySecret("wrong-secret", hash), false);
});

test("hashSecret salts each hash", () => {
  const secret = "same-secret";
  assert.notEqual(hashSecret(secret), hashSecret(secret));
});

test("verifySecret accepts legacy unsalted SHA-256 hashes", () => {
  const secret = "legacy-secret";
  const legacyHash = createHash("sha256").update(secret, "utf8").digest("hex");
  assert.equal(verifySecret(secret, legacyHash), true);
  assert.equal(verifySecret("wrong-secret", legacyHash), false);
});

test("verifySecret rejects malformed hashes", () => {
  assert.equal(verifySecret("anything", "scrypt:deadbeef"), false);
  assert.equal(verifySecret("anything", "not-a-hash"), false);
});
