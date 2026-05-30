import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const raw = process.env.CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY is required for programmatic user token mint",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      "CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)",
    );
  }
  return key;
}

/** Encrypt a mint credential (Keycloak RO password) for storage in Postgres. */
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** Decrypt a stored mint credential. */
export function decryptCredential(encoded: string): string {
  const data = Buffer.from(encoded, "base64");
  if (data.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted credential blob");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
