import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storedKey: string | undefined;

beforeEach(() => {
  storedKey = process.env.MCP_ENCRYPTION_KEY;
  // Fresh 32-byte key per test run.
  process.env.MCP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  // `~/env` caches validated config at module load; reset so re-imports
  // pick up the current process.env values.
  vi.resetModules();
});

afterEach(() => {
  if (storedKey === undefined) {
    delete process.env.MCP_ENCRYPTION_KEY;
  } else {
    process.env.MCP_ENCRYPTION_KEY = storedKey;
  }
  vi.resetModules();
});

async function load() {
  return await import("../crypto");
}

describe("crypto", () => {
  it("roundtrips a plaintext value", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const plaintext = "Bearer sk_test_abc123";
    const ciphertext = encryptSecret(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("produces a v1: prefixed string with 4 colon-separated parts", async () => {
    const { encryptSecret } = await load();
    const ciphertext = encryptSecret("hello");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    // each remaining part should be valid base64
    for (const part of parts.slice(1)) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", async () => {
    const { encryptSecret } = await load();
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
  });

  it("identifies encrypted secrets via isEncryptedSecret", async () => {
    const { encryptSecret, isEncryptedSecret } = await load();
    const ciphertext = encryptSecret("x");
    expect(isEncryptedSecret(ciphertext)).toBe(true);
    expect(isEncryptedSecret("plain text")).toBe(false);
    expect(isEncryptedSecret("v1:only:three")).toBe(false);
    expect(isEncryptedSecret("v2:a:b:c")).toBe(false);
  });

  it("rejects ciphertext with tampered authTag", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const ciphertext = encryptSecret("payload");
    const [v, iv, cipher, tag] = ciphertext.split(":") as [
      string,
      string,
      string,
      string,
    ];
    // Flip a bit in the tag.
    const tagBuf = Buffer.from(tag, "base64");
    tagBuf[0] = tagBuf[0]! ^ 0x01;
    const tampered = `${v}:${iv}:${cipher}:${tagBuf.toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects ciphertext with tampered ciphertext body", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const ciphertext = encryptSecret("payload");
    const [v, iv, cipher, tag] = ciphertext.split(":") as [
      string,
      string,
      string,
      string,
    ];
    const cipherBuf = Buffer.from(cipher, "base64");
    cipherBuf[0] = cipherBuf[0]! ^ 0x01;
    const tampered = `${v}:${iv}:${cipherBuf.toString("base64")}:${tag}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects unknown version prefix", async () => {
    const { encryptSecret, decryptSecret, EncryptionFormatError } = await load();
    const ciphertext = encryptSecret("payload");
    const swapped = ciphertext.replace(/^v1:/, "v9:");
    expect(() => decryptSecret(swapped)).toThrow(EncryptionFormatError);
  });

  it("rejects malformed (wrong number of parts) input", async () => {
    const { decryptSecret, EncryptionFormatError } = await load();
    expect(() => decryptSecret("v1:only:two")).toThrow(EncryptionFormatError);
    expect(() => decryptSecret("totally-not-encrypted")).toThrow(
      EncryptionFormatError,
    );
  });

  it("throws MissingEncryptionKeyError when env var is absent", async () => {
    delete process.env.MCP_ENCRYPTION_KEY;
    const { encryptSecret, MissingEncryptionKeyError } = await load();
    expect(() => encryptSecret("x")).toThrow(MissingEncryptionKeyError);
  });

  it("rejects keys that decode to the wrong length", async () => {
    process.env.MCP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    const { encryptSecret, EncryptionFormatError } = await load();
    expect(() => encryptSecret("x")).toThrow(EncryptionFormatError);
  });

  it("encrypts an empty string roundtrip-cleanly", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const ciphertext = encryptSecret("");
    expect(decryptSecret(ciphertext)).toBe("");
  });

  it("encrypts a long string (4KB) roundtrip-cleanly", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const plaintext = "a".repeat(4096);
    const ciphertext = encryptSecret(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });
});
