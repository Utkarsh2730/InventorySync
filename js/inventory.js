// inventory.js: the pure business rules for InventorySync.
//
// This file must never touch the page (DOM), browser globals or storage. Every
// function takes a state object and returns a result, so the rules can be
// tested on their own (tests.html) and reused unchanged in a React app later.
//
// Write functions all follow the same pattern:
//   1. can(user, action, storeId) is the FIRST check. A refusal returns at once.
//   2. Validate every input against the current state. Nothing is changed yet.
//   3. Only if everything passes: deep-copy the state, apply the change to the
//      copy, add log entries, and return { ok: true, errors: [], state: copy }.
// A refused or invalid call returns { ok: false, errors: [...], state } where
// `state` is the very same object that was passed in, untouched.

export const DATA_VERSION = 2; // 2: products have a brand; names are English only
export const STATUSES = ['OK', 'Low', 'Out', 'Stopped'];
export const MAX_QTY = 100000; // upper bound for any single quantity or level
export const LOG_LIMIT = 1000; // keep only the newest log entries

export const ROLE_LABELS = { manager: 'Store Manager', buyer: 'Inventory Buyer', admin: 'Admin' };

export const ACTION_LABELS = {
  sell: 'sell',
  receive: 'receive stock',
  transfer: 'transfer stock',
  setReorder: 'change reorder levels',
  addProduct: 'add products',
  setSelling: 'change which items this shop sells',
  manageInvites: 'manage invite codes',
  addStore: 'add shops',
};

// ---------------------------------------------------------------------------
// Status rule
// ---------------------------------------------------------------------------

// Out at 0; Low at or below the reorder level; otherwise OK.
export function statusOf(qty, reorderLevel) {
  if (qty <= 0) return 'Out';
  if (qty <= reorderLevel) return 'Low';
  return 'OK';
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

// Permission matrix:
//   Store Manager (a shop):  sell, receive, stop/resume selling (own store
//                            only); add products to the chain catalogue
//   Inventory Buyer (head office code): receive (any store), transfer,
//                            setReorder, addProduct; never sell
//   Admin:                   manage invite codes, add shops; no stock changes
// Anything else, or a missing user, is refused.
export function can(user, action, storeId) {
  if (!user) return false;
  if (user.role === 'manager') {
    if (action === 'addProduct') return true;
    const ownStore = storeId === user.storeId;
    return ownStore && ['sell', 'receive', 'setSelling'].includes(action);
  }
  if (user.role === 'buyer') {
    return ['receive', 'transfer', 'setReorder', 'addProduct'].includes(action);
  }
  if (user.role === 'admin') {
    return ['manageInvites', 'addStore'].includes(action);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Small helpers (not exported unless useful to the UI or tests)
// ---------------------------------------------------------------------------

export function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0 && n <= MAX_QTY;
}

export function isNonNegativeInt(n) {
  return Number.isInteger(n) && n >= 0 && n <= MAX_QTY;
}

export function findStore(state, storeId) {
  return state.stores.find((s) => s.id === storeId) || null;
}

export function findProduct(state, sku) {
  return state.products.find((p) => p.sku === sku) || null;
}

function storeName(state, storeId) {
  const s = findStore(state, storeId);
  return s ? s.name : String(storeId);
}

// "Toor Dal 1 kg (Tata Sampann)": the brand tells apart the same item
// stocked from different brands. Used in every message and button label.
export function productLabel(product) {
  if (!product) return '';
  return product.brand ? `${product.name} (${product.brand})` : product.name;
}

function productName(state, sku) {
  const p = findProduct(state, sku);
  return p ? productLabel(p) : String(sku);
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function refuse(state, errors) {
  return { ok: false, errors, state };
}

function refusalMessage(state, user, action, storeId) {
  if (!user) return 'Nobody is signed in, so nothing was changed.';
  const where = storeId ? ` at ${storeName(state, storeId)}` : '';
  return `${user.name} (${ROLE_LABELS[user.role] || user.role}) is not allowed to ${ACTION_LABELS[action] || action}${where}. Nothing was changed.`;
}

function addLog(next, entries) {
  const time = new Date().toISOString();
  for (const e of entries) next.log.push({ time, ...e });
  if (next.log.length > LOG_LIMIT) next.log = next.log.slice(-LOG_LIMIT);
}

// ---------------------------------------------------------------------------
// R1: checkout (all or nothing)
// ---------------------------------------------------------------------------

// cart: [{ sku, qty }]. The caller must pass the LATEST saved state
// (app.js re-reads saved data just before calling this), so a sale made in
// another tab is taken into account.
export function checkout(state, user, storeId, cart) {
  if (!can(user, 'sell', storeId)) return refuse(state, [refusalMessage(state, user, 'sell', storeId)]);

  if (!findStore(state, storeId)) return refuse(state, [`Unknown store "${storeId}".`]);
  if (!Array.isArray(cart) || cart.length === 0) return refuse(state, ['The cart is empty.']);

  // Add up duplicate lines for the same SKU so two lines of 2 are checked as 4.
  const errors = [];
  const totals = new Map();
  for (const line of cart) {
    const sku = line && line.sku;
    const qty = line && line.qty;
    if (!state.stock[storeId][sku]) {
      errors.push(`Unknown product "${sku}".`);
      continue;
    }
    if (state.stock[storeId][sku].stopped) {
      errors.push(`${productName(state, sku)}: ${storeName(state, storeId)} has stopped selling this item.`);
      continue;
    }
    if (!isPositiveInt(qty)) {
      errors.push(`${productName(state, sku)}: quantity must be a whole number from 1 to ${MAX_QTY}.`);
      continue;
    }
    totals.set(sku, (totals.get(sku) || 0) + qty);
  }
  for (const [sku, qty] of totals) {
    const inStock = state.stock[storeId][sku].qty;
    if (qty > inStock) {
      errors.push(`${productName(state, sku)}: only ${inStock} in stock at ${storeName(state, storeId)}, cannot sell ${qty}.`);
    }
  }
  if (errors.length > 0) return refuse(state, errors);

  // Every line passed: apply all of them to a copy.
  const next = clone(state);
  const entries = [];
  for (const [sku, qty] of totals) {
    next.stock[storeId][sku].qty -= qty;
    entries.push({ type: 'sale', storeId, sku, change: -qty, userId: user.id });
  }
  addLog(next, entries);
  return { ok: true, errors: [], state: next };
}

// ---------------------------------------------------------------------------
// R3: transfer between stores (chain total unchanged)
// ---------------------------------------------------------------------------

export function transfer(state, user, fromStoreId, toStoreId, sku, qty) {
  if (!can(user, 'transfer', fromStoreId)) return refuse(state, [refusalMessage(state, user, 'transfer', fromStoreId)]);

  const errors = [];
  if (!findStore(state, fromStoreId)) errors.push(`Unknown source store "${fromStoreId}".`);
  if (!findStore(state, toStoreId)) errors.push(`Unknown destination store "${toStoreId}".`);
  if (fromStoreId === toStoreId) errors.push('Choose two different stores for a transfer.');
  if (!findProduct(state, sku)) errors.push(`Unknown product "${sku}".`);
  if (!isPositiveInt(qty)) errors.push(`Quantity must be a whole number from 1 to ${MAX_QTY}.`);
  if (errors.length > 0) return refuse(state, errors);

  const available = state.stock[fromStoreId][sku].qty;
  if (qty > available) {
    return refuse(state, [`${productName(state, sku)}: only ${available} at ${storeName(state, fromStoreId)}, cannot transfer ${qty}.`]);
  }

  const next = clone(state);
  next.stock[fromStoreId][sku].qty -= qty;
  next.stock[toStoreId][sku].qty += qty;
  addLog(next, [
    { type: 'transfer', storeId: fromStoreId, sku, change: -qty, userId: user.id },
    { type: 'transfer', storeId: toStoreId, sku, change: qty, userId: user.id },
  ]);
  return { ok: true, errors: [], state: next };
}

// ---------------------------------------------------------------------------
// Receive a delivery into one store
// ---------------------------------------------------------------------------

export function receive(state, user, storeId, sku, qty) {
  if (!can(user, 'receive', storeId)) return refuse(state, [refusalMessage(state, user, 'receive', storeId)]);

  const errors = [];
  if (!findStore(state, storeId)) errors.push(`Unknown store "${storeId}".`);
  if (!findProduct(state, sku)) errors.push(`Unknown product "${sku}".`);
  if (!isPositiveInt(qty)) errors.push(`Quantity must be a whole number from 1 to ${MAX_QTY}.`);
  if (errors.length > 0) return refuse(state, errors);

  if (state.stock[storeId][sku].qty + qty > MAX_QTY) {
    return refuse(state, [`${productName(state, sku)}: stock cannot go above ${MAX_QTY}.`]);
  }

  const next = clone(state);
  next.stock[storeId][sku].qty += qty;
  addLog(next, [{ type: 'receive', storeId, sku, change: qty, userId: user.id }]);
  return { ok: true, errors: [], state: next };
}

// ---------------------------------------------------------------------------
// Reorder level (per store and SKU)
// ---------------------------------------------------------------------------

export function setReorderLevel(state, user, storeId, sku, level) {
  if (!can(user, 'setReorder', storeId)) return refuse(state, [refusalMessage(state, user, 'setReorder', storeId)]);

  const errors = [];
  if (!findStore(state, storeId)) errors.push(`Unknown store "${storeId}".`);
  if (!findProduct(state, sku)) errors.push(`Unknown product "${sku}".`);
  if (!isNonNegativeInt(level)) errors.push(`Reorder level must be a whole number from 0 to ${MAX_QTY}.`);
  if (errors.length > 0) return refuse(state, errors);

  const next = clone(state);
  next.stock[storeId][sku].reorderLevel = level;
  // Logged as an "adjust" with no quantity change; the new level is recorded.
  addLog(next, [{ type: 'adjust', storeId, sku, change: 0, reorderLevel: level, userId: user.id }]);
  return { ok: true, errors: [], state: next };
}

// ---------------------------------------------------------------------------
// Add a product (shops and head office). Starts at 0 in every store.
// ---------------------------------------------------------------------------

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;

// Product names and brands are kept in one language (English) so the stock
// list never mixes scripts: letters, digits, spaces and . , ' " & ( ) / + % -
export const ENGLISH_TEXT = /^[A-Za-z0-9 .,'"&()/+%-]+$/;

export function addProduct(state, user, input) {
  if (!can(user, 'addProduct', null)) return refuse(state, [refusalMessage(state, user, 'addProduct', null)]);

  const sku = String((input && input.sku) || '').trim().toUpperCase();
  const name = String((input && input.name) || '').trim().replace(/\s+/g, ' ');
  const brand = String((input && input.brand) || '').trim().replace(/\s+/g, ' ');
  const price = input && input.price;
  const reorderLevel = input && input.reorderLevel;

  const errors = [];
  if (!SKU_PATTERN.test(sku)) errors.push('SKU must be 2–24 characters: letters, digits and dashes, starting with a letter or digit.');
  else if (findProduct(state, sku)) errors.push(`SKU "${sku}" already exists.`);
  if (name.length < 2 || name.length > 80) errors.push('Name must be 2–80 characters.');
  else if (!ENGLISH_TEXT.test(name)) errors.push('Write the name in English letters only (no other scripts or symbols).');
  if (brand.length < 2 || brand.length > 40) errors.push('Brand must be 2–40 characters.');
  else if (!ENGLISH_TEXT.test(brand)) errors.push('Write the brand in English letters only (no other scripts or symbols).');
  const same = state.products.find((p) => p.name.toLowerCase() === name.toLowerCase()
    && String(p.brand || '').toLowerCase() === brand.toLowerCase());
  if (same) errors.push(`${productLabel(same)} already exists as SKU ${same.sku}.`);
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 10000000) {
    errors.push('Price must be a number from 0 to 1,00,00,000.');
  }
  if (!isNonNegativeInt(reorderLevel)) errors.push(`Reorder level must be a whole number from 0 to ${MAX_QTY}.`);
  if (errors.length > 0) return refuse(state, errors);

  const next = clone(state);
  next.products.push({ sku, name, brand, price: Math.round(price * 100) / 100 });
  for (const store of next.stores) {
    next.stock[store.id][sku] = { qty: 0, reorderLevel };
  }
  addLog(next, [{ type: 'adjust', storeId: null, sku, change: 0, note: 'product added', userId: user.id }]);
  return { ok: true, errors: [], state: next };
}

// ---------------------------------------------------------------------------
// Stop / resume selling an item in one shop (one click, no quantity change)
// ---------------------------------------------------------------------------

// selling = false marks the item as stopped at that shop: it leaves the
// alerts and Low/Out counts and cannot be sold there. selling = true resumes it.
export function setSelling(state, user, storeId, sku, selling) {
  if (!can(user, 'setSelling', storeId)) return refuse(state, [refusalMessage(state, user, 'setSelling', storeId)]);

  const errors = [];
  if (!findStore(state, storeId)) errors.push(`Unknown store "${storeId}".`);
  if (!findProduct(state, sku)) errors.push(`Unknown product "${sku}".`);
  if (typeof selling !== 'boolean') errors.push('Choose whether to stop or resume selling.');
  if (errors.length > 0) return refuse(state, errors);

  const isStopped = Boolean(state.stock[storeId][sku].stopped);
  if (isStopped === !selling) {
    return refuse(state, [`${productName(state, sku)} is already ${selling ? 'on sale' : 'stopped'} at ${storeName(state, storeId)}.`]);
  }

  const next = clone(state);
  if (selling) delete next.stock[storeId][sku].stopped;
  else next.stock[storeId][sku].stopped = true;
  addLog(next, [{ type: 'adjust', storeId, sku, change: 0, note: selling ? 'resumed selling' : 'stopped selling', userId: user.id }]);
  return { ok: true, errors: [], state: next };
}

// ---------------------------------------------------------------------------
// Shops and invite codes (admin)
// ---------------------------------------------------------------------------

// Codes look like ABCD-EFGH-JKLM. The admin page makes the random part;
// this file only checks and stores codes, so it stays free of randomness.
export const INVITE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// Accept codes typed in lower case, with spaces or without dashes.
export function normalizeCode(code) {
  const plain = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return plain.length === 12 ? `${plain.slice(0, 4)}-${plain.slice(4, 8)}-${plain.slice(8)}` : plain;
}

function invitesOf(state) {
  return Array.isArray(state.invites) ? state.invites : [];
}

export function findInvite(state, code) {
  const wanted = normalizeCode(code);
  return invitesOf(state).find((i) => i.code === wanted) || null;
}

// input: { code, storeId ('all' for a head-office code), label, now (ISO time) }
export function createInvite(state, actor, input) {
  if (!can(actor, 'manageInvites', null)) return refuse(state, [refusalMessage(state, actor, 'manageInvites', null)]);

  const code = normalizeCode(input && input.code);
  const storeId = input && input.storeId;
  const label = String((input && input.label) || '').trim();

  const errors = [];
  if (!INVITE_PATTERN.test(code)) errors.push('The invite code has the wrong format.');
  else if (findInvite(state, code)) errors.push('That invite code already exists. Generate a new one.');
  if (storeId !== 'all' && !findStore(state, storeId)) errors.push('Choose the shop this code is for.');
  if (label.length < 2 || label.length > 60) errors.push('Give the code a name of 2–60 characters, for example "Indiranagar counter".');
  if (errors.length > 0) return refuse(state, errors);

  const next = clone(state);
  next.invites = invitesOf(next);
  next.invites.push({
    code,
    role: storeId === 'all' ? 'buyer' : 'manager',
    storeId: storeId === 'all' ? null : storeId,
    label,
    createdAt: (input && input.now) || new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
  });
  return { ok: true, errors: [], state: next };
}

export function revokeInvite(state, actor, code) {
  if (!can(actor, 'manageInvites', null)) return refuse(state, [refusalMessage(state, actor, 'manageInvites', null)]);
  const invite = findInvite(state, code);
  if (!invite) return refuse(state, ['Unknown invite code.']);
  if (invite.revoked) return refuse(state, ['That invite code is already revoked.']);

  const next = clone(state);
  next.invites.find((i) => i.code === invite.code).revoked = true;
  return { ok: true, errors: [], state: next };
}

// Forgotten admin passcode: the admin page can only start over by revoking
// every invite code (there is no server to prove who is asking). Like
// signInWithCode this has no signed-in user; it can only ever take access
// away, never give it. Stock, shops and products are kept.
export function revokeAllInvites(state) {
  const next = clone(state);
  next.invites = invitesOf(next).map((i) => ({ ...i, revoked: true }));
  return { ok: true, errors: [], state: next, revoked: invitesOf(state).filter((i) => !i.revoked).length };
}

// The signed-in "user" for a shop is its invite code. Revoked or unknown
// codes give null, which signs the shop out.
export function userFromInvite(state, code) {
  const invite = findInvite(state, code);
  if (!invite || invite.revoked) return null;
  if (invite.role === 'manager' && !findStore(state, invite.storeId)) return null;
  return { id: `invite:${invite.code}`, name: invite.label, role: invite.role, storeId: invite.storeId };
}

// Signing in is the one write that has no signed-in user yet: the valid,
// unrevoked code itself is the permission. It records when the code was used.
export function signInWithCode(state, code, now) {
  const user = userFromInvite(state, code);
  if (!user) {
    const invite = findInvite(state, code);
    const reason = invite && invite.revoked
      ? 'This invite code has been revoked. Ask head office for a new one.'
      : 'That invite code is not valid. Check it and try again.';
    return { ok: false, errors: [reason], state, user: null };
  }
  const next = clone(state);
  next.invites.find((i) => i.code === normalizeCode(code)).lastUsedAt = now || new Date().toISOString();
  return { ok: true, errors: [], state: next, user };
}

// input: { name, city }. The new shop starts with every product at 0.
export function addStore(state, actor, input) {
  if (!can(actor, 'addStore', null)) return refuse(state, [refusalMessage(state, actor, 'addStore', null)]);

  const name = String((input && input.name) || '').trim();
  const city = String((input && input.city) || '').trim();
  const errors = [];
  if (name.length < 2 || name.length > 40) errors.push('Shop name must be 2–40 characters.');
  else if (state.stores.some((st) => st.name.toLowerCase() === name.toLowerCase())) errors.push(`A shop called "${name}" already exists.`);
  if (city.length > 40) errors.push('City must be at most 40 characters.');
  if (errors.length > 0) return refuse(state, errors);

  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'shop';
  let id = base;
  for (let n = 2; findStore(state, id); n += 1) id = `${base}-${n}`;

  const next = clone(state);
  next.stores.push({ id, name, city });
  next.stock[id] = {};
  for (const p of next.products) next.stock[id][p.sku] = { qty: 0, reorderLevel: 5 };
  return { ok: true, errors: [], state: next, storeId: id };
}

// ---------------------------------------------------------------------------
// Read-only views used by the UI, CSV export and tests
// ---------------------------------------------------------------------------

// One row per store and SKU, with the chain-wide total for that SKU (R2).
export function buildRows(state) {
  const chainTotals = {};
  for (const p of state.products) {
    chainTotals[p.sku] = state.stores.reduce((sum, s) => sum + state.stock[s.id][p.sku].qty, 0);
  }
  const rows = [];
  for (const s of state.stores) {
    for (const p of state.products) {
      const { qty, reorderLevel, stopped } = state.stock[s.id][p.sku];
      rows.push({
        storeId: s.id,
        storeName: s.name,
        sku: p.sku,
        name: p.name,
        brand: p.brand || '',
        price: p.price,
        qty,
        reorderLevel,
        stopped: Boolean(stopped),
        status: stopped ? 'Stopped' : statusOf(qty, reorderLevel),
        value: qty * p.price,
        chainTotal: chainTotals[p.sku],
      });
    }
  }
  return rows;
}

// R9: search by name or SKU, filter by store and by status.
// filters: { query: string (name, brand or SKU), storeId: 'all' | id, status: 'all' | 'OK' | 'Low' | 'Out' | 'Stopped' }
// 'all' means every item the shop still sells; 'Stopped' lists only the
// items it has stopped selling.
export function filterRows(rows, filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const storeId = filters.storeId || 'all';
  const status = filters.status || 'all';
  return rows.filter((r) => {
    if (storeId !== 'all' && r.storeId !== storeId) return false;
    if (status === 'all' && r.status === 'Stopped') return false;
    if (status !== 'all' && r.status !== status) return false;
    if (query && ![r.name, r.brand, r.sku].some((text) => String(text).toLowerCase().includes(query))) return false;
    return true;
  });
}

// Rows for one store, or for every store when storeId is 'all' or missing.
function rowsForStore(state, storeId) {
  const rows = buildRows(state);
  return storeId && storeId !== 'all' ? rows.filter((r) => r.storeId === storeId) : rows;
}

// Numbers for the four summary cards: one store, or the whole chain.
export function summarize(state, storeId = 'all') {
  const rows = rowsForStore(state, storeId);
  return {
    totalSkus: state.products.length,
    low: rows.filter((r) => r.status === 'Low').length,
    out: rows.filter((r) => r.status === 'Out').length,
    stopped: rows.filter((r) => r.status === 'Stopped').length,
    stockValue: rows.reduce((sum, r) => sum + r.value, 0),
  };
}

// R5: every item needing action in one store (or every store), Out first, then Low.
export function alertsOf(state, storeId = 'all') {
  return rowsForStore(state, storeId)
    .filter((r) => r.status === 'Low' || r.status === 'Out')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Out' ? -1 : 1));
}

// The store a user should see first: a manager's own store, otherwise all.
export function defaultStoreFor(user) {
  return user && user.role === 'manager' && user.storeId ? user.storeId : 'all';
}

// ---------------------------------------------------------------------------
// Data upgrades (the `version` field exists for exactly this)
// ---------------------------------------------------------------------------

// Brands of the sample products, used when upgrading data saved before
// products had brands. Any other product gets "Unbranded".
const SAMPLE_BRANDS = {
  'TOOR-1KG': 'Tata Sampann',
  'ATTA-5KG': 'Aashirvaad',
  'BASM-5KG': 'India Gate',
  'SUNOIL-1L': 'Fortune',
  'SUGAR-1KG': 'Madhur',
  'SALT-1KG': 'Tata Salt',
  'TEA-500G': 'Tata Tea Gold',
  'MILK-500ML': 'Nandini',
  'GHEE-500ML': 'Amul',
  'BISC-MARIE': 'Britannia',
  'SOAP-4PK': 'Mysore Sandal',
  'DET-1KG': 'Surf Excel',
  'RAGI-1KG': '24 Mantra Organic',
  'COFFEE-200G': 'Cothas',
};

// Keep only the English part of a name: drop brackets that contain another
// script, e.g. "Basmati Rice 5 kg (बासमती चावल)" -> "Basmati Rice 5 kg".
export function englishOnly(text) {
  const cleaned = String(text || '')
    .replace(/\s*\([^)]*[^\x00-\x7F][^)]*\)/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

// Upgrade saved data to the current version. Returns the data unchanged if
// it is already current, the upgraded copy, or null if it cannot be upgraded.
export function upgradeData(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.version === DATA_VERSION) return data;
  if (data.version !== 1 || !Array.isArray(data.products)) return null;
  const next = clone(data);
  next.version = 2;
  next.products = next.products.map((p) => ({
    ...p,
    name: englishOnly(p.name) || p.sku,
    brand: typeof p.brand === 'string' && p.brand ? englishOnly(p.brand) || 'Unbranded' : (SAMPLE_BRANDS[p.sku] || 'Unbranded'),
  }));
  return next;
}

// Shape check for data loaded from storage. Also rejects negative stock, so
// a hand-edited saved value cannot sneak a negative quantity in.
export function isValidState(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.version !== DATA_VERSION) return false;
  if (!Array.isArray(s.stores) || !Array.isArray(s.products) || !Array.isArray(s.users) || !Array.isArray(s.log)) return false;
  if (!s.stock || typeof s.stock !== 'object') return false;
  for (const store of s.stores) {
    if (!store || typeof store.id !== 'string' || typeof store.name !== 'string') return false;
    const perStore = s.stock[store.id];
    if (!perStore || typeof perStore !== 'object') return false;
    for (const p of s.products) {
      if (!p || typeof p.sku !== 'string' || typeof p.name !== 'string' || typeof p.price !== 'number') return false;
      if (typeof p.brand !== 'string') return false;
      const entry = perStore[p.sku];
      if (!entry || !isNonNegativeInt(entry.qty) || !isNonNegativeInt(entry.reorderLevel)) return false;
    }
  }
  for (const u of s.users) {
    if (!u || typeof u.id !== 'string' || typeof u.name !== 'string' || !ROLE_LABELS[u.role]) return false;
  }
  // Invite codes were added later, so older saved data may not have them.
  if (s.invites !== undefined) {
    if (!Array.isArray(s.invites)) return false;
    for (const i of s.invites) {
      if (!i || typeof i.code !== 'string' || typeof i.label !== 'string' || !ROLE_LABELS[i.role]) return false;
    }
  }
  return true;
}
