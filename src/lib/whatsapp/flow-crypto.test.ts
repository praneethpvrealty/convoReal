import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptFlowRequest,
  encryptFlowResponse,
  generateFlowKeyPair,
  FlowDecryptionError,
  type EncryptedFlowRequestBody,
} from "./flow-crypto";

/**
 * Simulates the WhatsApp client side of the Flows encryption handshake:
 * a fresh AES-128 key RSA-OAEP(SHA-256)-encrypted with our public key,
 * the payload AES-GCM encrypted with tag appended.
 */
function encryptLikeMeta(
  payload: Record<string, unknown>,
  publicKeyPem: string,
  opts?: { aesKey?: Buffer; iv?: Buffer }
): { body: EncryptedFlowRequestBody; aesKey: Buffer; iv: Buffer } {
  const aesKey = opts?.aesKey ?? crypto.randomBytes(16);
  const iv = opts?.iv ?? crypto.randomBytes(16);

  const encryptedAesKey = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey
  );

  const cipher = crypto.createCipheriv(
    aesKey.length === 16 ? "aes-128-gcm" : "aes-256-gcm",
    aesKey,
    iv
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    body: {
      encrypted_flow_data: Buffer.concat([ciphertext, tag]).toString("base64"),
      encrypted_aes_key: encryptedAesKey.toString("base64"),
      initial_vector: iv.toString("base64"),
    },
    aesKey,
    iv,
  };
}

/** Decrypts an endpoint response the way the WhatsApp client would. */
function decryptResponseLikeMeta(
  base64Response: string,
  aesKey: Buffer,
  requestIv: Buffer
): Record<string, unknown> {
  const flippedIv = Buffer.from(requestIv.map((b) => ~b & 0xff));
  const raw = Buffer.from(base64Response, "base64");
  const ciphertext = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flippedIv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

describe("generateFlowKeyPair", () => {
  it("produces a 2048-bit SPKI public and PKCS8 private PEM pair", () => {
    const { publicKeyPem, privateKeyPem } = generateFlowKeyPair();
    expect(publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    const key = crypto.createPublicKey(publicKeyPem);
    expect(key.asymmetricKeyType).toBe("rsa");
  });
});

describe("decryptFlowRequest", () => {
  const { publicKeyPem, privateKeyPem } = generateFlowKeyPair();

  it("round-trips a Meta-encrypted request payload", () => {
    const payload = {
      version: "3.0",
      action: "data_exchange",
      flow_token: "tok-123",
      data: { min_budget: "5000000", areas: "JP Nagar, Jayanagar" },
    };
    const { body } = encryptLikeMeta(payload, publicKeyPem);

    const result = decryptFlowRequest(body, privateKeyPem);
    expect(result.payload).toEqual(payload);
    expect(result.aesKey.length).toBe(16);
    expect(result.initialVector.length).toBe(16);
  });

  it("also supports 256-bit AES keys", () => {
    const payload = { action: "ping" };
    const { body } = encryptLikeMeta(payload, publicKeyPem, {
      aesKey: crypto.randomBytes(32),
    });
    expect(decryptFlowRequest(body, privateKeyPem).payload).toEqual(payload);
  });

  it("throws FlowDecryptionError when decrypted with the wrong private key", () => {
    const otherPair = generateFlowKeyPair();
    const { body } = encryptLikeMeta({ action: "ping" }, publicKeyPem);
    expect(() => decryptFlowRequest(body, otherPair.privateKeyPem)).toThrow(
      FlowDecryptionError
    );
  });

  it("throws FlowDecryptionError on tampered ciphertext (GCM tag mismatch)", () => {
    const { body } = encryptLikeMeta({ action: "ping" }, publicKeyPem);
    const raw = Buffer.from(body.encrypted_flow_data, "base64");
    raw[0] = raw[0] ^ 0xff;
    body.encrypted_flow_data = raw.toString("base64");
    expect(() => decryptFlowRequest(body, privateKeyPem)).toThrow(FlowDecryptionError);
  });

  it("throws FlowDecryptionError on a body missing the encrypted fields", () => {
    expect(() => decryptFlowRequest({ foo: "bar" }, privateKeyPem)).toThrow(
      FlowDecryptionError
    );
    expect(() => decryptFlowRequest(null, privateKeyPem)).toThrow(FlowDecryptionError);
  });
});

describe("encryptFlowResponse", () => {
  const { publicKeyPem, privateKeyPem } = generateFlowKeyPair();

  it("encrypts so the client can decrypt with the flipped request IV", () => {
    const { body } = encryptLikeMeta({ action: "ping" }, publicKeyPem);
    const { aesKey, initialVector } = decryptFlowRequest(body, privateKeyPem);

    const response = { data: { status: "active" } };
    const encrypted = encryptFlowResponse(response, aesKey, initialVector);

    expect(decryptResponseLikeMeta(encrypted, aesKey, initialVector)).toEqual(response);
  });

  it("does not mutate the request IV buffer", () => {
    const iv = crypto.randomBytes(16);
    const original = Buffer.from(iv);
    encryptFlowResponse({ ok: true }, crypto.randomBytes(16), iv);
    expect(iv.equals(original)).toBe(true);
  });
});
