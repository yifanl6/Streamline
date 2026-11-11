import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalized(value: unknown, path = '$'): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error(`${path} must be a finite safe integer`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalized(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new Error(`${path}.${key} must not be undefined`);
      out[key] = normalized(item, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path} has unsupported type ${typeof value}`);
}

/** Stable JSON used for hashes and signatures. Monetary values must be decimal strings. */
export const canonicalJson = (value: unknown): string => JSON.stringify(normalized(value));
export const sha256 = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

export interface SigningKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export interface SignedEnvelope<T> {
  alg: 'Ed25519';
  keyId: string;
  publicKey: string;
  payload: T;
  signature: string;
}

export const generateSigningKeys = (): SigningKeys => generateKeyPairSync('ed25519');

export function exportPrivateKey(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'der' }).toString('base64url');
}

export function importPrivateKey(encoded: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(encoded, 'base64url'), type: 'pkcs8', format: 'der' });
}

export function publicKeyString(key: KeyObject): string {
  const publicKey = key.type === 'public' ? key : createPublicKey(key);
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
}

export function signEnvelope<T>(payload: T, privateKey: KeyObject, keyId = sha256(publicKeyString(privateKey)).slice(0, 16)): SignedEnvelope<T> {
  const publicKey = publicKeyString(privateKey);
  const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64url');
  return { alg: 'Ed25519', keyId, publicKey, payload, signature };
}

export function verifyEnvelope<T>(envelope: SignedEnvelope<T>, trustedPublicKeys?: ReadonlySet<string>): boolean {
  if (envelope.alg !== 'Ed25519' || !envelope.publicKey || !envelope.signature) return false;
  if (trustedPublicKeys && !trustedPublicKeys.has(envelope.publicKey)) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(envelope.publicKey, 'base64url'), type: 'spki', format: 'der' });
    return verify(null, Buffer.from(canonicalJson(envelope.payload)), publicKey, Buffer.from(envelope.signature, 'base64url'));
  } catch {
    return false;
  }
}
