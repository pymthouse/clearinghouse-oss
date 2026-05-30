import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifySecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "hex");
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
