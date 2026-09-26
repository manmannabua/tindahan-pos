/**
 * Device identity key pair. See docs/DEVICE_MANAGEMENT.md §1.
 *
 * ECDSA P-256, private key NON-extractable: script running in this page can use it to sign but
 * can never read or export its bytes. The CryptoKey objects are stored in IndexedDB (structured
 * clone keeps them non-extractable).
 */

const ALGORITHM: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALGORITHM: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is unavailable. The POS must run on https:// or localhost.");
  }
  return globalThis.crypto.subtle;
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function generateDeviceKeys(): Promise<CryptoKeyPair> {
  // extractable=false applies to the private key; public keys are always exportable.
  return subtle().generateKey(ALGORITHM, false, ["sign", "verify"]);
}

/** Base64 SPKI DER — the format POST /devices/register expects. */
export async function exportPublicKey(keys: CryptoKeyPair): Promise<string> {
  return toBase64(await subtle().exportKey("spki", keys.publicKey));
}

export function challengeMessage(deviceId: string, nonce: string): string {
  return `pos-device-auth\n${deviceId}\n${nonce}`;
}

/** Signature as base64 of raw r||s (IEEE P1363), WebCrypto's native ECDSA output. */
export async function signChallenge(keys: CryptoKeyPair, deviceId: string, nonce: string): Promise<string> {
  const data = new TextEncoder().encode(challengeMessage(deviceId, nonce));
  return toBase64(await subtle().sign(SIGN_ALGORITHM, keys.privateKey, data));
}
