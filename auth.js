// auth.js - register, log in, log out, auto-lock.
// The encryption key lives only in memory: closing or locking the app forgets it,
// so the diary must be unlocked with the password again.

import * as db from './db.js';
import { hashPassword, deriveEncryptionKey, randomBytes, toBase64, safeEqual } from './crypto.js';
import { isValidEmail, passwordProblems } from './utils.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;
const attempts = new Map(); // email -> { count, until }

let session = null; // { email, key }

export function currentUser() {
  return session;
}

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function register(emailInput, password) {
  const email = normaliseEmail(emailInput);
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`Password needs ${problems.join(', ')}.`);
  if (await db.getUser(email)) throw new Error('An account with this email already exists on this device.');

  const salt = toBase64(randomBytes(16));
  const keySalt = toBase64(randomBytes(16));
  const hash = await hashPassword(password, salt);
  await db.addUser({ email, salt, hash, keySalt, createdAt: Date.now() });
  session = { email, key: await deriveEncryptionKey(password, keySalt) };
  localStorage.setItem('pd-last-email', email);
  return session;
}

/** Seconds left before another login attempt is allowed (0 = allowed now). */
export function lockoutSecondsLeft(emailInput) {
  const a = attempts.get(normaliseEmail(emailInput));
  if (!a || !a.until) return 0;
  return Math.max(0, Math.ceil((a.until - Date.now()) / 1000));
}

export async function login(emailInput, password) {
  const email = normaliseEmail(emailInput);
  const wait = lockoutSecondsLeft(email);
  if (wait > 0) throw new Error(`Too many attempts. Try again in ${wait} seconds.`);

  const user = await db.getUser(email);
  // Always run the hash, even for unknown emails, so both cases take the same time.
  const hash = await hashPassword(password || '', user ? user.salt : toBase64(randomBytes(16)));
  if (!user || !safeEqual(hash, user.hash)) {
    const a = attempts.get(email) || { count: 0, until: 0 };
    a.count += 1;
    if (a.count >= MAX_ATTEMPTS) {
      a.until = Date.now() + LOCKOUT_MS;
      a.count = 0;
    }
    attempts.set(email, a);
    throw new Error('Email or password is incorrect.'); // same message for both: no account enumeration
  }
  attempts.delete(email);
  session = { email, key: await deriveEncryptionKey(password, user.keySalt) };
  localStorage.setItem('pd-last-email', email);
  return session;
}

export function logout() {
  session = null;
}

export async function deleteAccount() {
  if (!session) return;
  await db.deleteUserAndData(session.email);
  localStorage.removeItem('pd-last-email');
  session = null;
}
