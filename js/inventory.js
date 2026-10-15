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

export const DATA_VERSION = 1;
export const STATUSES = ['OK', 'Low', 'Out'];
export const MAX_QTY = 100000; // upper bound for any single quantity or level
export const LOG_LIMIT = 1000; // keep only the newest log entries

export const ROLE_LABELS = { manager: 'Store Manager', buyer: 'Inventory Buyer' };

export const ACTION_LABELS = {
  sell: 'sell',
  receive: 'receive stock',
  transfer: 'transfer stock',
  setReorder: 'change reorder levels',
  addProduct: 'add products',
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
//   Store Manager:   sell, receive (own store only)
//   Inventory Buyer: receive (any store), transfer, setReorder, addProduct;
//                    never sell
// Anything else, or a missing user, is refused.
export function can(user, action, storeId) {
  if (!user) return false;
  if (user.role === 'manager') {
    const ownStore = storeId === user.storeId;
    return ownStore && (action === 'sell' || action === 'receive');
  }
  if (user.role === 'buyer') {
    return ['receive', 'transfer', 'setReorder', 'addProduct'].includes(action);
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

function productName(state, sku) {
  const p = findProduct(state, sku);
  return p ? p.name : String(sku);
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
// Add a product (Buyer only). Starts at 0 in every store.
// ---------------------------------------------------------------------------

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;

export function addProduct(state, user, input) {
  if (!can(user, 'addProduct', null)) return refuse(state, [refusalMessage(state, user, 'addProduct', null)]);

  const sku = String((input && input.sku) || '').trim().toUpperCase();
  const name = String((input && input.name) || '').trim();
  const price = input && input.price;
  const reorderLevel = input && input.reorderLevel;

  const errors = [];
  if (!SKU_PATTERN.test(sku)) errors.push('SKU must be 2–24 characters: letters, digits and dashes, starting with a letter or digit.');
  else if (findProduct(state, sku)) errors.push(`SKU "${sku}" already exists.`);
  if (name.length < 2 || name.length > 80) errors.push('Name must be 2–80 characters.');
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 10000000) {
    errors.push('Price must be a number from 0 to 1,00,00,000.');
  }
  if (!isNonNegativeInt(reorderLevel)) errors.push(`Reorder level must be a whole number from 0 to ${MAX_QTY}.`);
  if (errors.length > 0) return refuse(state, errors);

  const next = clone(state);
  next.products.push({ sku, name, price: Math.round(price * 100) / 100 });
  for (const store of next.stores) {
    next.stock[store.id][sku] = { qty: 0, reorderLevel };
  }
  addLog(next, [{ type: 'adjust', storeId: null, sku, change: 0, note: 'product added', userId: user.id }]);
  return { ok: true, errors: [], state: next };
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
      const { qty, reorderLevel } = state.stock[s.id][p.sku];
      rows.push({
        storeId: s.id,
        storeName: s.name,
        sku: p.sku,
        name: p.name,
        price: p.price,
        qty,
        reorderLevel,
        status: statusOf(qty, reorderLevel),
        value: qty * p.price,
        chainTotal: chainTotals[p.sku],
      });
    }
  }
  return rows;
}

// R9: search by name or SKU, filter by store and by status.
// filters: { query: string, storeId: 'all' | id, status: 'all' | 'OK' | 'Low' | 'Out' }
export function filterRows(rows, filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const storeId = filters.storeId || 'all';
  const status = filters.status || 'all';
  return rows.filter((r) => {
    if (storeId !== 'all' && r.storeId !== storeId) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (query && !r.name.toLowerCase().includes(query) && !r.sku.toLowerCase().includes(query)) return false;
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
    stockValue: rows.reduce((sum, r) => sum + r.value, 0),
  };
}

// R5: every item needing action in one store (or every store), Out first, then Low.
export function alertsOf(state, storeId = 'all') {
  return rowsForStore(state, storeId)
    .filter((r) => r.status !== 'OK')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'Out' ? -1 : 1));
}

// The store a user should see first: a manager's own store, otherwise all.
export function defaultStoreFor(user) {
  return user && user.role === 'manager' && user.storeId ? user.storeId : 'all';
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
      const entry = perStore[p.sku];
      if (!entry || !isNonNegativeInt(entry.qty) || !isNonNegativeInt(entry.reorderLevel)) return false;
    }
  }
  for (const u of s.users) {
    if (!u || typeof u.id !== 'string' || typeof u.name !== 'string' || !ROLE_LABELS[u.role]) return false;
  }
  return true;
}
