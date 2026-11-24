// crypto.js - password hashing and encryption using the built-in Web Crypto API.
// Works in browsers (iOS Safari 11+, Android Chrome) and in Node 20+ (for tests).
//
// - Passwords are never stored. We store a PBKDF2-SHA256 hash with a random salt.
// - Diary entries are encrypted with AES-GCM (256-bit). The key is derived from the
//   user's password and only ever kept in memory, so data at rest is unreadable
//   without the password.

const subtle = globalThis.crypto.subtle;
export const PBKDF2_ITERATIONS = 150000;

export function randomBytes(length = 16) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

async function passwordKeyMaterial(password) {
  return subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
}

/** Returns a base64 PBKDF2 hash of the password. */
export async function hashPassword(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const material = await passwordKeyMaterial(password);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return toBase64(bits);
}

/** Compare two strings without stopping early (avoids timing leaks). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Derives the AES-GCM key used to encrypt this user's diary. Not extractable. */
export async function deriveEncryptionKey(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const material = await passwordKeyMaterial(password);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts any JSON-serialisable value. A new random IV is used every time. */
export async function encryptJSON(key, value) {
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: toBase64(iv), data: toBase64(cipher) };
}

/** Decrypts a value made by encryptJSON. Throws if the key is wrong or data was changed. */
export async function decryptJSON(key, box) {
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(box.iv) },
    key,
    fromBase64(box.data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
