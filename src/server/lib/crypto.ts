import crypto from "node:crypto";

import { env } from "~/env";

/**
 * AES-256-GCM symmetric encryption helpers for at-rest secrets.
 *
 * Storage format: `v1:${ivB64}:${ciphertextB64}:${authTagB64}` (colon-
 * separated, all base64). The leading `v1:` prefix lets us rotate keys
 * later via an online migration (decrypt-with-old, re-encrypt-with-new,
 * rewrite) without a flag-day. Pattern is industry-standard (Fernet,
 * Tink, Vault all version their ciphertexts).
 *
 * Key source: `MCP_ENCRYPTION_KEY` env var, base64-encoded 32 bytes.
 * Generate with `openssl rand -base64 32`. Must persist across deploys
 * — losing the key makes every encrypted row unreadable.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const VERSION = "v1";

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "MCP_ENCRYPTION_KEY is not set. Set it in your environment (base64-encoded 32 bytes) to use MCP auth-header storage. Generate with `openssl rand -base64 32`.",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

export class EncryptionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionFormatError";
  }
}

function loadKey(): Buffer {
  const raw = env.MCP_ENCRYPTION_KEY;
  if (!raw) {
    throw new MissingEncryptionKeyError();
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new EncryptionFormatError(
      `MCP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). Regenerate with \`openssl rand -base64 32\`.`,
    );
  }
  return decoded;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) {
    throw new EncryptionFormatError(
      `Expected 4 colon-separated parts in encrypted value (got ${parts.length}).`,
    );
  }
  const [version, ivB64, cipherB64, tagB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) {
    throw new EncryptionFormatError(
      `Unknown ciphertext version "${version}". Only "${VERSION}" is supported.`,
    );
  }
  const key = loadKey();
  const iv = Buffer.from(ivB64, "base64");
  const cipherBuf = Buffer.from(cipherB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new EncryptionFormatError(
      `IV must be ${IV_BYTES} bytes (got ${iv.length}).`,
    );
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new EncryptionFormatError(
      `Auth tag must be ${AUTH_TAG_BYTES} bytes (got ${authTag.length}).`,
    );
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(cipherBuf),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}
