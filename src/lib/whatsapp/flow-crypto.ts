import crypto from 'node:crypto'

/**
 * Encryption layer for the Meta WhatsApp Flows data-exchange endpoint.
 *
 * Meta encrypts every request to a Flow endpoint with a hybrid scheme:
 *   1. A fresh AES key (128-bit) is RSA-OAEP(SHA-256) encrypted with the
 *      business public key we registered via
 *      POST /{phone_number_id}/whatsapp_business_encryption.
 *   2. The JSON payload is AES-GCM encrypted with that key and a fresh
 *      IV; the 16-byte auth tag is appended to the ciphertext.
 *
 * The response must be encrypted with the SAME AES key but the IV
 * bitwise-inverted (each byte XOR 0xFF), returned as a plain base64
 * string body — not JSON.
 *
 * Reference:
 *   https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */

const GCM_TAG_LENGTH = 16

export interface EncryptedFlowRequestBody {
  encrypted_flow_data: string
  encrypted_aes_key: string
  initial_vector: string
}

/** Decrypted request payload as documented by Meta. */
export interface FlowEndpointRequest {
  version?: string
  action?: 'ping' | 'INIT' | 'BACK' | 'data_exchange'
  screen?: string
  flow_token?: string
  data?: Record<string, unknown>
}

export interface DecryptedFlowRequest {
  payload: FlowEndpointRequest
  aesKey: Buffer
  initialVector: Buffer
}

/** Thrown when the request cannot be decrypted with our private key.
 *  The endpoint must answer HTTP 421 so the WhatsApp client re-fetches
 *  the business public key. */
export class FlowDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FlowDecryptionError'
  }
}

/**
 * Generate the RSA-2048 keypair for a tenant's Flows endpoint.
 * Public key (SPKI PEM) is registered with Meta; private key (PKCS8
 * PEM) is stored encrypted at rest in whatsapp_config.
 */
export function generateFlowKeyPair(): {
  publicKeyPem: string
  privateKeyPem: string
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey, privateKeyPem: privateKey }
}

function isEncryptedFlowRequestBody(
  body: unknown
): body is EncryptedFlowRequestBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  return (
    typeof b.encrypted_flow_data === 'string' &&
    typeof b.encrypted_aes_key === 'string' &&
    typeof b.initial_vector === 'string'
  )
}

/**
 * Decrypt an incoming Flows endpoint request.
 * Returns the parsed payload plus the AES key + IV needed to encrypt
 * the response. Throws FlowDecryptionError on any crypto failure.
 */
export function decryptFlowRequest(
  body: unknown,
  privateKeyPem: string
): DecryptedFlowRequest {
  if (!isEncryptedFlowRequestBody(body)) {
    throw new FlowDecryptionError(
      'Request body is missing encrypted_flow_data / encrypted_aes_key / initial_vector'
    )
  }

  let aesKey: Buffer
  try {
    aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(body.encrypted_aes_key, 'base64')
    )
  } catch (err) {
    throw new FlowDecryptionError(
      'Failed to RSA-decrypt the AES key — the registered public key may be stale',
      { cause: err }
    )
  }

  if (aesKey.length !== 16 && aesKey.length !== 32) {
    throw new FlowDecryptionError(
      `Unexpected AES key length ${aesKey.length} (expected 16 or 32 bytes)`
    )
  }

  const flowData = Buffer.from(body.encrypted_flow_data, 'base64')
  const initialVector = Buffer.from(body.initial_vector, 'base64')
  if (flowData.length <= GCM_TAG_LENGTH) {
    throw new FlowDecryptionError('encrypted_flow_data too short to contain a GCM tag')
  }

  const ciphertext = flowData.subarray(0, flowData.length - GCM_TAG_LENGTH)
  const authTag = flowData.subarray(flowData.length - GCM_TAG_LENGTH)

  try {
    const decipher = crypto.createDecipheriv(
      aesKey.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm',
      aesKey,
      initialVector
    )
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return {
      payload: JSON.parse(decrypted.toString('utf8')) as FlowEndpointRequest,
      aesKey,
      initialVector,
    }
  } catch (err) {
    throw new FlowDecryptionError('Failed to AES-GCM decrypt the flow data', {
      cause: err,
    })
  }
}

/**
 * Encrypt the endpoint response for the WhatsApp client: AES-GCM with
 * the request's key and the bitwise-inverted request IV; auth tag
 * appended; base64-encoded.
 */
export function encryptFlowResponse(
  response: Record<string, unknown>,
  aesKey: Buffer,
  initialVector: Buffer
): string {
  const flippedIv = Buffer.alloc(initialVector.length)
  for (let i = 0; i < initialVector.length; i++) {
    flippedIv[i] = ~initialVector[i] & 0xff
  }
  const cipher = crypto.createCipheriv(
    aesKey.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm',
    aesKey,
    flippedIv
  )
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return encrypted.toString('base64')
}
