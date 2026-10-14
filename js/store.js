// store.js: load, save, reset, sample data and tab-to-tab sync.
//
// All data lives in ONE localStorage key, `inventorysync:v1`, as JSON:
//   { version, stores, products, stock, users, log }
// with stock[storeId][sku] = { qty, reorderLevel }.
//
// Sync (R4): after every save we post a message on the BroadcastChannel
// "inventorysync". Other open tabs re-read the key and redraw. The `storage`
// event (fired in other tabs when the key changes) is the fallback for
// browsers without BroadcastChannel. Both can fire for one save, so we
// compare the raw JSON text and skip a redraw when nothing changed. Listeners
// only read and redraw; they never save, so there is no redraw loop.

import { isValidState } from './inventory.js';

export const STORAGE_KEY = 'inventorysync:v1';
const CHANNEL_NAME = 'inventorysync';
let sampleUrl = 'data/sample-data.json';

// Optional: the React build passes the URL Vite gives the bundled sample file.
export function configure(options = {}) {
  if (options.sampleUrl) sampleUrl = options.sampleUrl;
}

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;

const storageOk = checkStorage();
let lastRaw = null; // the JSON text this tab last saved or loaded

function checkStorage() {
  try {
    const probe = '__inventorysync_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function isStorageAvailable() {
  return storageOk;
}

async function fetchSample() {
  const response = await fetch(sampleUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${sampleUrl} (HTTP ${response.status}).`);
  const data = await response.json();
  if (!isValidState(data)) throw new Error(`${sampleUrl} is not valid InventorySync data.`);
  return data;
}

function readRaw() {
  if (!storageOk) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw) {
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw);
    return isValidState(data) ? data : null;
  } catch {
    return null;
  }
}

// Load saved data, or the sample on first run.
// Returns { state, notice } where notice is a message for the user or null.
export async function load() {
  if (!storageOk) {
    const state = await fetchSample();
    return {
      state,
      notice: 'Browser storage is unavailable (for example in some private windows). The demo works, but changes are lost on refresh and other tabs will not sync.',
    };
  }

  const raw = readRaw();
  if (raw === null) {
    const state = await fetchSample();
    const saved = save(state);
    return { state, notice: saved.ok ? null : saved.error };
  }

  const state = parse(raw);
  if (state) {
    lastRaw = raw;
    return { state, notice: null };
  }

  // Corrupt JSON, a different version, or a bad shape: restore the sample.
  const sample = await fetchSample();
  const saved = save(sample);
  return {
    state: sample,
    notice: 'Saved data was unreadable or from a different version, so the sample data has been restored.' + (saved.ok ? '' : ' ' + saved.error),
  };
}

// Synchronous re-read of the latest saved state. Write actions call this
// first so they never work on a stale copy. Returns null if there is nothing
// valid saved (the caller then keeps its in-memory state).
export function readLatest() {
  return parse(readRaw());
}

// Save the whole state, then tell other tabs. Returns { ok, error }.
export function save(state) {
  // No storage: keep working in memory only (load() already warned the user).
  if (!storageOk) return { ok: true, error: null };
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch (err) {
    const full = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {
      ok: false,
      error: full
        ? 'Browser storage is full, so this change was not saved. Use Reset data or clear site data, then try again.'
        : 'This change could not be saved to browser storage.',
    };
  }
  lastRaw = raw;
  if (channel) channel.postMessage({ type: 'saved' });
  return { ok: true, error: null };
}

// Clear the key and restore the sample data. Returns the new state.
export async function reset() {
  const sample = await fetchSample();
  if (storageOk) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore: save() below reports any real problem
    }
  }
  const saved = save(sample);
  return { state: sample, notice: saved.ok ? null : saved.error };
}

// Call onChange(state) whenever another tab saves new data.
// Returns a function that stops listening (used by the React version).
export function subscribe(onChange) {
  const check = () => {
    const raw = readRaw();
    if (raw === null || raw === lastRaw) return; // nothing new (or mid-reset)
    const state = parse(raw);
    if (!state) return;
    lastRaw = raw;
    onChange(state);
  };
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY || event.key === null) check();
  };
  if (channel) channel.addEventListener('message', check);
  window.addEventListener('storage', onStorage);
  return () => {
    if (channel) channel.removeEventListener('message', check);
    window.removeEventListener('storage', onStorage);
  };
}
