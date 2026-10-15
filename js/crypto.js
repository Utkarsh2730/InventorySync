// crypto.js: password helpers shared by the admin page, the shop page and the
// React build. Uses the browser's Web Crypto API (needs https or localhost).
//
// Passwords are never stored. We store a random salt and a PBKDF2-SHA-256
// hash; signing in hashes the typed password with the same salt and compares.

export const PASSWORD_ITERATIONS = 150000;

// No 0/O, 1/l/I: easy to read out and type.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function isCryptoAvailable() {
  return Boolean(globalThis.crypto && globalThis.crypto.subtle);
}

export function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

// PBKDF2-SHA-256, 256-bit result, as base64.
export async function hashSecret(secret, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toBase64(new Uint8Array(bits));
}

// A random 12-character password shown as Xk7m-Pq4z-R9tw (about 69 bits).
// Rejection sampling keeps every character equally likely.
export function generatePassword() {
  const chars = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  while (chars.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && chars.length < 12) chars.push(PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]);
    }
  }
  const s = chars.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

// Hash a new password: returns what an account stores.
export async function makePasswordRecord(password) {
  const salt = newSalt();
  return { salt: toBase64(salt), hash: await hashSecret(password, salt, PASSWORD_ITERATIONS), iterations: PASSWORD_ITERATIONS };
}

// Hash a typed password with an account's stored salt, for signing in.
export function hashForAccount(password, account) {
  return hashSecret(password, fromBase64(account.salt), account.iterations || PASSWORD_ITERATIONS);
}
