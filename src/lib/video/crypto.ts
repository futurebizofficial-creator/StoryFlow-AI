import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = process.env.STORYFLOW_CREDENTIALS_KEY;
  if (!value) throw new Error("STORYFLOW_CREDENTIALS_KEY must be configured to store BYOK credentials.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error("STORYFLOW_CREDENTIALS_KEY must be a base64-encoded 32-byte key.");
  return bytes;
}

export function encryptSecret(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64") };
}

export function decryptSecret(value: { ciphertext: string; nonce: string; auth_tag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(value.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(value.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
