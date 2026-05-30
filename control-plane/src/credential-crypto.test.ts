import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";

test("encryptCredential round-trips", () => {
  process.env.CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const plain = "test-mint-password";
  const enc = encryptCredential(plain);
  assert.notEqual(enc, plain);
  assert.equal(decryptCredential(enc), plain);
});
