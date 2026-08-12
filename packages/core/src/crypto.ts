import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** NFR5: ev adresleri uygulama katmaninda AES-256-GCM ile sifrelenir. */
const ALGO = "aes-256-gcm";

function key(): Buffer {
  // Was padEnd(32, "0"), which turned a missing ADDRESS_ENC_KEY into an all-zero AES key and
  // encrypted every address under a value anyone could guess. Reject instead. AddressCrypto.java
  // enforces the same rule, and both take the first 32 utf8 bytes, so ciphertexts stay
  // interchangeable between the two backends.
  const raw = process.env.ADDRESS_ENC_KEY ?? "";
  if (raw.trim().length === 0 || raw.length < 32) {
    throw new Error(
      "ADDRESS_ENC_KEY must be at least 32 characters (AES-256); refusing to fall back to a padded key",
    );
  }
  return Buffer.from(raw.slice(0, 32), "utf8");
}

export function encryptAddress(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptAddress(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
