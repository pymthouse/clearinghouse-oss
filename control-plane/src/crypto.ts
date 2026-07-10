import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;
// N=2^14 keeps per-auth cost low enough for the control-plane API while making
// offline dictionary attacks on a leaked hash expensive.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashSecret(secret: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `${SCRYPT_PREFIX}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifySecret(secret: string, expectedHash: string): boolean {
  if (expectedHash.startsWith(`${SCRYPT_PREFIX}:`)) {
    const [, saltHex, hashHex] = expectedHash.split(":");
    if (!saltHex || !hashHex) return false;
    const actual = scryptSync(secret, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN, SCRYPT_OPTIONS);
    const expected = Buffer.from(hashHex, "hex");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  // Legacy rows: unsalted SHA-256 hex. Admin hashes upgrade on restart via
  // ensureAdminConfig; app M2M hashes upgrade on secret rotation.
  const actual = createHash("sha256").update(secret, "utf8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function generateClientId(prefix: "app" | "m2m"): string {
  const suffix = randomBytes(8).toString("hex");
  return `${prefix}_${suffix}`;
}

export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}
