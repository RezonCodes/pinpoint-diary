// Unit tests for js/crypto.js (password hashing + AES-GCM encryption).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, deriveEncryptionKey, encryptJSON, decryptJSON, safeEqual,
  randomBytes, toBase64, fromBase64,
} from './crypto.js';

const FAST = 1000; // fewer PBKDF2 rounds just to keep tests quick

test('base64 round-trip keeps bytes identical', () => {
  const bytes = randomBytes(32);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
});

test('same password + salt gives the same hash; different salt gives a different hash', async () => {
  const salt1 = toBase64(randomBytes(16));
  const salt2 = toBase64(randomBytes(16));
  const a = await hashPassword('secret123', salt1, FAST);
  const b = await hashPassword('secret123', salt1, FAST);
  const c = await hashPassword('secret123', salt2, FAST);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, await hashPassword('Secret123', salt1, FAST));
});

test('the stored hash never contains the password', async () => {
  const hash = await hashPassword('mypassword1', toBase64(randomBytes(16)), FAST);
  assert.ok(!hash.includes('mypassword1'));
  assert.equal(fromBase64(hash).length, 32); // 256-bit hash
});

test('safeEqual compares correctly', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual('abc', 'abcd'));
  assert.ok(!safeEqual(undefined, 'abc'));
});

test('encrypt then decrypt returns the original data', async () => {
  const key = await deriveEncryptionKey('pw12345678', toBase64(randomBytes(16)), FAST);
  const original = { title: 'Sunset', note: 'Lovely ☀️', lat: 56.46 };
  const box = await encryptJSON(key, original);
  assert.ok(!box.data.includes('Sunset')); // ciphertext is not readable
  assert.deepEqual(await decryptJSON(key, box), original);
});

test('each encryption uses a fresh IV', async () => {
  const key = await deriveEncryptionKey('pw12345678', toBase64(randomBytes(16)), FAST);
  const a = await encryptJSON(key, 'same');
  const b = await encryptJSON(key, 'same');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

test('wrong password cannot decrypt', async () => {
  const salt = toBase64(randomBytes(16));
  const right = await deriveEncryptionKey('correct-horse1', salt, FAST);
  const wrong = await deriveEncryptionKey('wrong-horse1', salt, FAST);
  const box = await encryptJSON(right, { secret: true });
  await assert.rejects(() => decryptJSON(wrong, box));
});

test('tampered data is detected', async () => {
  const key = await deriveEncryptionKey('pw12345678', toBase64(randomBytes(16)), FAST);
  const box = await encryptJSON(key, { amount: 1 });
  const bytes = fromBase64(box.data);
  bytes[0] ^= 1; // flip one bit
  await assert.rejects(() => decryptJSON(key, { iv: box.iv, data: toBase64(bytes) }));
});
