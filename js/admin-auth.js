// admin-auth.js: the head-office admin passcode. The admin signs in on the
// normal sign-in screen with the Shop ID "admin" and this passcode.
//
// The passcode lives in its own localStorage key (not in the shared stock
// data), stored as a salted PBKDF2 hash, never as typed. Same key as the old
// separate admin page, so an existing passcode keeps working.

import { hashSecret, newSalt, toBase64, fromBase64, PASSWORD_ITERATIONS } from './crypto.js';

const AUTH_KEY = 'inventorysync:admin'; // { salt, hash, iterations }

export const ADMIN_USER = { id: 'admin', name: 'Admin', role: 'admin', storeId: null };

export function readAdminAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY));
    return auth && auth.salt && auth.hash ? auth : null;
  } catch {
    return null;
  }
}

export function hasAdminPasscode() {
  return Boolean(readAdminAuth());
}

// Hash the typed passcode with the stored salt (null if none is set).
export async function hashAdminPasscode(passcode) {
  const auth = readAdminAuth();
  if (!auth) return null;
  return hashSecret(passcode, fromBase64(auth.salt), auth.iterations || PASSWORD_ITERATIONS);
}

// Save a new passcode (first set-up or change). Returns the new hash.
export async function saveAdminPasscode(passcode) {
  const salt = newSalt();
  const auth = { salt: toBase64(salt), hash: await hashSecret(passcode, salt, PASSWORD_ITERATIONS), iterations: PASSWORD_ITERATIONS };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  return auth.hash;
}

export function clearAdminPasscode() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // nothing stored
  }
}

// A tab is signed in as admin while its saved hash matches the passcode.
export function isAdminSession(hash) {
  const auth = readAdminAuth();
  return Boolean(auth && hash && auth.hash === hash);
}
