// tests.js: critical-path checks for the pure rules. No test library.
// Every test builds its own in-memory state, so the user's real
// localStorage data is never read or changed.

import {
  statusOf,
  can,
  checkout,
  transfer,
  receive,
  setReorderLevel,
  addProduct,
  buildRows,
  filterRows,
  summarize,
  alertsOf,
  isValidState,
  defaultStoreFor,
  setSelling,
  createInvite,
  revokeInvite,
  signInWithCode,
  userFromInvite,
  normalizeCode,
  addStore,
  upgradeData,
  productLabel,
} from './inventory.js';
import { escapeCsvCell, rowsToCsv } from './export.js';

// A small fixture: two stores, two products, two managers and a buyer.
function makeState() {
  return {
    version: 2,
    stores: [
      { id: 'A', name: 'Store A', city: 'Test' },
      { id: 'B', name: 'Store B', city: 'Test' },
    ],
    products: [
      { sku: 'DAL', name: 'Toor Dal 1 kg', brand: 'Tata Sampann', price: 165 },
      { sku: 'GHEE', name: 'Ghee, "Pure" 500 ml', brand: 'Amul', price: 340 },
    ],
    stock: {
      A: { DAL: { qty: 3, reorderLevel: 5 }, GHEE: { qty: 0, reorderLevel: 2 } },
      B: { DAL: { qty: 20, reorderLevel: 5 }, GHEE: { qty: 10, reorderLevel: 2 } },
    },
    users: [
      { id: 'mA', name: 'Manager A', role: 'manager', storeId: 'A' },
      { id: 'mB', name: 'Manager B', role: 'manager', storeId: 'B' },
      { id: 'buyer', name: 'Buyer', role: 'buyer', storeId: null },
      { id: 'admin', name: 'Admin', role: 'admin', storeId: null },
    ],
    invites: [],
    log: [],
  };
}

const user = (s, id) => s.users.find((u) => u.id === id);
const chainTotal = (s, sku) => s.stores.reduce((n, st) => n + s.stock[st.id][sku].qty, 0);

export function runTests() {
  const results = [];
  const check = (name, fn) => {
    try {
      const passed = fn() === true;
      results.push({ name, passed, error: passed ? '' : 'returned false' });
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
    }
  };

  // --- Status thresholds -------------------------------------------------
  check('Status: Out at 0', () => statusOf(0, 5) === 'Out');
  check('Status: Out at 0 even when reorder level is 0', () => statusOf(0, 0) === 'Out');
  check('Status: Low exactly at the reorder level', () => statusOf(5, 5) === 'Low');
  check('Status: Low below the reorder level', () => statusOf(1, 5) === 'Low');
  check('Status: OK one above the reorder level', () => statusOf(6, 5) === 'OK');

  // --- R1: never-negative checkout --------------------------------------
  check('R1: with 3 in stock, selling 2 succeeds and leaves 1', () => {
    const s = makeState();
    const r = checkout(s, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 2 }]);
    return r.ok && r.state.stock.A.DAL.qty === 1;
  });
  check('R1: a second sale of 2 is refused and stock stays at 1', () => {
    const s = makeState();
    const first = checkout(s, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 2 }]);
    const second = checkout(first.state, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 2 }]);
    return first.ok && !second.ok && second.state.stock.A.DAL.qty === 1 && second.errors.length === 1;
  });
  check('R1: a sale larger than stock is refused and state is unchanged', () => {
    const s = makeState();
    const before = JSON.stringify(s);
    const r = checkout(s, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 4 }]);
    return !r.ok && r.state === s && JSON.stringify(s) === before;
  });
  check('R1: a cart with one bad line changes nothing', () => {
    const s = makeState();
    s.stock.A.GHEE.qty = 5;
    const before = JSON.stringify(s);
    const r = checkout(s, user(s, 'mA'), 'A', [{ sku: 'GHEE', qty: 1 }, { sku: 'DAL', qty: 9 }]);
    return !r.ok && JSON.stringify(s) === before && r.state.stock.A.GHEE.qty === 5;
  });
  check('R1: duplicate cart lines are added up before checking', () => {
    const s = makeState();
    const r = checkout(s, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 2 }, { sku: 'DAL', qty: 2 }]);
    return !r.ok && r.state.stock.A.DAL.qty === 3;
  });
  check('R1: zero, negative, fractional and empty carts are refused', () => {
    const s = makeState();
    const m = user(s, 'mA');
    return [0, -1, 1.5, NaN].every((q) => !checkout(s, m, 'A', [{ sku: 'DAL', qty: q }]).ok)
      && !checkout(s, m, 'A', []).ok
      && !checkout(s, m, 'A', [{ sku: 'NOPE', qty: 1 }]).ok;
  });
  check('R1: a successful sale adds one log entry per line', () => {
    const s = makeState();
    s.stock.A.GHEE.qty = 5;
    const r = checkout(s, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 1 }, { sku: 'GHEE', qty: 2 }]);
    return r.ok && r.state.log.length === 2 && r.state.log.every((e) => e.type === 'sale' && e.userId === 'mA');
  });

  // --- R3: transfers keep the chain total -------------------------------
  check('R3: moving 5 from B to A gives B −5, A +5, total unchanged', () => {
    const s = makeState();
    const r = transfer(s, user(s, 'buyer'), 'B', 'A', 'DAL', 5);
    return r.ok
      && r.state.stock.B.DAL.qty === 15
      && r.state.stock.A.DAL.qty === 8
      && chainTotal(r.state, 'DAL') === chainTotal(s, 'DAL');
  });
  check('R3: a transfer larger than the source stock is refused', () => {
    const s = makeState();
    const before = JSON.stringify(s);
    const r = transfer(s, user(s, 'buyer'), 'A', 'B', 'DAL', 4);
    return !r.ok && JSON.stringify(s) === before;
  });
  check('R3: same source and destination is refused', () => {
    const s = makeState();
    return !transfer(s, user(s, 'buyer'), 'B', 'B', 'DAL', 1).ok;
  });

  // --- R6: roles ---------------------------------------------------------
  check('R6: a manager cannot transfer (state unchanged)', () => {
    const s = makeState();
    const before = JSON.stringify(s);
    const r = transfer(s, user(s, 'mB'), 'B', 'A', 'DAL', 5);
    return !r.ok && JSON.stringify(s) === before && r.state === s;
  });
  check('R6: a manager cannot sell in another store', () => {
    const s = makeState();
    const r = checkout(s, user(s, 'mA'), 'B', [{ sku: 'DAL', qty: 1 }]);
    return !r.ok && r.state.stock.B.DAL.qty === 20;
  });
  check('R6: a manager cannot change reorder levels', () => {
    const s = makeState();
    const r = setReorderLevel(s, user(s, 'mA'), 'A', 'DAL', 1);
    return !r.ok && s.stock.A.DAL.reorderLevel === 5;
  });
  check('R6: a manager can receive in their own store only', () => {
    const s = makeState();
    return receive(s, user(s, 'mA'), 'A', 'DAL', 2).ok && !receive(s, user(s, 'mA'), 'B', 'DAL', 2).ok;
  });
  check('R6: a buyer cannot sell', () => {
    const s = makeState();
    return !checkout(s, user(s, 'buyer'), 'B', [{ sku: 'DAL', qty: 1 }]).ok;
  });
  check('R6: a buyer can receive anywhere, set levels and add products; nobody signed in can do nothing', () => {
    const s = makeState();
    const b = user(s, 'buyer');
    return can(b, 'receive', 'A') && can(b, 'setReorder', 'B') && can(b, 'addProduct', null)
      && !can(null, 'receive', 'A') && !can(undefined, 'sell', 'A');
  });

  // --- Other writes ------------------------------------------------------
  check('Receive adds stock and logs it', () => {
    const s = makeState();
    const r = receive(s, user(s, 'buyer'), 'A', 'GHEE', 4);
    return r.ok && r.state.stock.A.GHEE.qty === 4 && r.state.log[0].type === 'receive' && s.stock.A.GHEE.qty === 0;
  });
  check('Set reorder level changes Low/OK status', () => {
    const s = makeState();
    const r = setReorderLevel(s, user(s, 'buyer'), 'A', 'DAL', 2);
    return r.ok && buildRows(r.state).find((x) => x.storeId === 'A' && x.sku === 'DAL').status === 'OK';
  });
  check('Add product starts at 0 in every store and rejects duplicates', () => {
    const s = makeState();
    const b = user(s, 'buyer');
    const r = addProduct(s, b, { sku: 'salt-1kg', name: 'Salt', brand: 'Tata Salt', price: 28, reorderLevel: 3 });
    const dup = addProduct(r.state, b, { sku: 'SALT-1KG', name: 'Salt again', brand: 'Tata Salt', price: 28, reorderLevel: 3 });
    return r.ok && r.state.stock.A['SALT-1KG'].qty === 0 && r.state.stock.B['SALT-1KG'].qty === 0 && !dup.ok;
  });

  // --- Views: R2, R5, R9 -------------------------------------------------
  check('R2: each row carries the chain total for its SKU', () => {
    const rows = buildRows(makeState());
    return rows.length === 4 && rows.filter((r) => r.sku === 'DAL').every((r) => r.chainTotal === 23);
  });
  check('R5: summary counts Low and Out; alerts list Out first', () => {
    const s = makeState();
    const sum = summarize(s);
    const alerts = alertsOf(s);
    return sum.low === 1 && sum.out === 1 && alerts.length === 2 && alerts[0].status === 'Out';
  });
  check('R5: cards and alerts for one store count only that store', () => {
    const s = makeState();
    const a = summarize(s, 'A');
    const b = summarize(s, 'B');
    return a.low === 1 && a.out === 1 && a.stockValue === 3 * 165
      && b.low === 0 && b.out === 0 && b.stockValue === 20 * 165 + 10 * 340
      && alertsOf(s, 'A').every((r) => r.storeId === 'A') && alertsOf(s, 'B').length === 0
      && alertsOf(s, 'all').length === 2;
  });
  check('A manager starts on their own store; the buyer starts on all stores', () => {
    const s = makeState();
    return defaultStoreFor(user(s, 'mB')) === 'B' && defaultStoreFor(user(s, 'buyer')) === 'all' && defaultStoreFor(null) === 'all';
  });
  check('R9: filter by search text, store and status', () => {
    const rows = buildRows(makeState());
    return filterRows(rows, { query: 'ghee' }).length === 2
      && filterRows(rows, { query: 'dal', storeId: 'B' }).length === 1
      && filterRows(rows, { status: 'Out' }).length === 1
      && filterRows(rows, { query: '  DAL ', storeId: 'all', status: 'all' }).length === 2;
  });

  // --- R10: CSV ----------------------------------------------------------
  check('R10: CSV escapes commas, quotes and line breaks', () =>
    escapeCsvCell('a,b') === '"a,b"' && escapeCsvCell('say "hi"') === '"say ""hi"""' && escapeCsvCell('x\ny') === '"x\ny"');
  check('R10: CSV for one store leaves out the all-stores total, like the screen', () => {
    const rows = filterRows(buildRows(makeState()), { storeId: 'A' });
    const one = rowsToCsv(rows, { includeChainTotal: false }).trim().split('\r\n');
    const all = rowsToCsv(rows).trim().split('\r\n');
    return !one[0].includes('All stores total') && one[0].split(',').length === 9
      && all[0].includes('All stores total') && all[0].split(',').length === 10
      && one[0].includes('Brand') && one[1].includes('Tata Sampann');
  });
  check('R10: CSV starts with a UTF-8 BOM, has ₹ in the header and one line per row', () => {
    const rows = filterRows(buildRows(makeState()), { storeId: 'A' });
    const csv = rowsToCsv(rows);
    const lines = csv.trim().split('\r\n');
    return csv.charCodeAt(0) === 0xfeff && lines[0].includes('₹') && lines.length === rows.length + 1;
  });

  // --- Brands and English-only names ------------------------------------
  check('Brands: the same item from another brand is a separate product', () => {
    const s = makeState();
    const r = addProduct(s, user(s, 'buyer'), { sku: 'DAL-24M', name: 'Toor Dal 1 kg', brand: '24 Mantra Organic', price: 189, reorderLevel: 2 });
    const rows = buildRows(r.state).filter((x) => x.storeId === 'A' && x.name === 'Toor Dal 1 kg');
    return r.ok && rows.length === 2 && rows.map((x) => x.brand).sort().join('|') === '24 Mantra Organic|Tata Sampann';
  });
  check('Brands: a product needs a brand, and the same name and brand cannot be added twice', () => {
    const s = makeState();
    const b = user(s, 'buyer');
    return !addProduct(s, b, { sku: 'DAL-X', name: 'Toor Dal 1 kg', brand: '', price: 1, reorderLevel: 1 }).ok
      && !addProduct(s, b, { sku: 'DAL-X', name: 'toor dal 1 KG', brand: 'TATA SAMPANN', price: 1, reorderLevel: 1 }).ok;
  });
  check('English only: names and brands in another script are refused', () => {
    const s = makeState();
    const b = user(s, 'buyer');
    return !addProduct(s, b, { sku: 'RICE-1', name: 'Basmati Rice (बासमती)', brand: 'India Gate', price: 1, reorderLevel: 1 }).ok
      && !addProduct(s, b, { sku: 'RICE-1', name: 'Basmati Rice', brand: 'ಇಂಡಿಯಾ', price: 1, reorderLevel: 1 }).ok
      && addProduct(s, b, { sku: 'RICE-1', name: 'Basmati Rice 5 kg (Extra Long)', brand: "Daawat & Co.", price: 1, reorderLevel: 1 }).ok;
  });
  check('Search matches the brand too, and messages name the brand', () => {
    const rows = buildRows(makeState());
    const s = makeState();
    const refused = checkout(s, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 9 }]);
    return filterRows(rows, { query: 'amul' }).every((r) => r.sku === 'GHEE') && filterRows(rows, { query: 'amul' }).length === 2
      && refused.errors[0].startsWith('Toor Dal 1 kg (Tata Sampann)') && productLabel({ name: 'X', brand: '' }) === 'X';
  });
  check('Upgrade: data saved before brands gets brands and English-only names', () => {
    const old = makeState();
    old.version = 1;
    old.products = [
      { sku: 'BASM-5KG', name: 'Basmati Rice 5 kg (बासमती चावल)', price: 699 },
      { sku: 'MY-OWN', name: 'Soap (4-pack)', price: 50 },
    ];
    old.stock = { A: { 'BASM-5KG': { qty: 1, reorderLevel: 1 }, 'MY-OWN': { qty: 2, reorderLevel: 1 } }, B: { 'BASM-5KG': { qty: 1, reorderLevel: 1 }, 'MY-OWN': { qty: 2, reorderLevel: 1 } } };
    const up = upgradeData(old);
    return up.version === 2 && isValidState(up) && old.version === 1
      && up.products[0].name === 'Basmati Rice 5 kg' && up.products[0].brand === 'India Gate'
      && up.products[1].name === 'Soap (4-pack)' && up.products[1].brand === 'Unbranded'
      && up.stock.A['MY-OWN'].qty === 2 && upgradeData({ version: 99 }) === null;
  });

  // --- Stop / resume selling (one click) ---------------------------------
  check('Stop selling: a shop stops an item at its own store only', () => {
    const s = makeState();
    const own = setSelling(s, user(s, 'mA'), 'A', 'DAL', false);
    const other = setSelling(s, user(s, 'mA'), 'B', 'DAL', false);
    const buyer = setSelling(s, user(s, 'buyer'), 'A', 'DAL', false);
    return own.ok && own.state.stock.A.DAL.stopped === true && !other.ok && !buyer.ok && !s.stock.A.DAL.stopped;
  });
  check('Stop selling: the item cannot be sold, leaves alerts and counts, and is listed under Stopped', () => {
    const s = makeState();
    const r = setSelling(s, user(s, 'mA'), 'A', 'DAL', false).state; // DAL at A was Low
    const sale = checkout(r, user(s, 'mA'), 'A', [{ sku: 'DAL', qty: 1 }]);
    const rows = buildRows(r);
    return !sale.ok && sale.errors[0].includes('stopped selling')
      && summarize(r, 'A').low === 0 && summarize(r, 'A').stopped === 1
      && alertsOf(r, 'A').every((a) => a.sku !== 'DAL')
      && filterRows(rows, { storeId: 'A' }).every((x) => x.sku !== 'DAL')
      && filterRows(rows, { storeId: 'A', status: 'Stopped' }).map((x) => x.sku).join() === 'DAL';
  });
  check('Resume selling brings the item back; stopping twice is refused', () => {
    const s = makeState();
    const m = user(s, 'mA');
    const stopped = setSelling(s, m, 'A', 'DAL', false).state;
    const twice = setSelling(stopped, m, 'A', 'DAL', false);
    const resumed = setSelling(stopped, m, 'A', 'DAL', true);
    return !twice.ok && resumed.ok && !resumed.state.stock.A.DAL.stopped && buildRows(resumed.state)[0].status === 'Low';
  });
  check('A shop manager can now add products', () => {
    const s = makeState();
    return addProduct(s, user(s, 'mA'), { sku: 'TEA-1', name: 'Tea', brand: 'Red Label', price: 10, reorderLevel: 1 }).ok;
  });

  // --- Invite codes and shops (admin) -------------------------------------
  const CODE = 'ABCD-EFGH-JKLM';
  const NOW = '2026-10-16T10:00:00.000Z';
  check('Invites: only the admin can create codes; a shop code signs in as that shop', () => {
    const s = makeState();
    const refused = createInvite(s, user(s, 'buyer'), { code: CODE, storeId: 'A', label: 'Shop A', now: NOW });
    const made = createInvite(s, user(s, 'admin'), { code: CODE, storeId: 'A', label: 'Shop A', now: NOW });
    const signed = signInWithCode(made.state, 'abcd efgh jklm', NOW);
    return !refused.ok && made.ok && signed.ok && signed.user.role === 'manager' && signed.user.storeId === 'A'
      && signed.state.invites[0].lastUsedAt === NOW && s.invites.length === 0;
  });
  check('Invites: a head-office code signs in as the buyer for all shops', () => {
    const s = makeState();
    const made = createInvite(s, user(s, 'admin'), { code: CODE, storeId: 'all', label: 'Head office', now: NOW });
    const u = userFromInvite(made.state, CODE);
    return made.ok && u.role === 'buyer' && u.storeId === null && can(u, 'transfer', 'A');
  });
  check('Invites: duplicate, badly formed or shop-less codes are refused', () => {
    const s = makeState();
    const a = user(s, 'admin');
    const first = createInvite(s, a, { code: CODE, storeId: 'A', label: 'Shop A', now: NOW });
    return !createInvite(first.state, a, { code: CODE, storeId: 'B', label: 'Shop B', now: NOW }).ok
      && !createInvite(s, a, { code: 'SHORT', storeId: 'A', label: 'Shop A', now: NOW }).ok
      && !createInvite(s, a, { code: CODE, storeId: 'NOPE', label: 'Shop A', now: NOW }).ok
      && !createInvite(s, a, { code: CODE, storeId: 'A', label: 'x', now: NOW }).ok;
  });
  check('Invites: a revoked or unknown code cannot sign in', () => {
    const s = makeState();
    const a = user(s, 'admin');
    const made = createInvite(s, a, { code: CODE, storeId: 'A', label: 'Shop A', now: NOW }).state;
    const revoked = revokeInvite(made, a, CODE).state;
    return userFromInvite(revoked, CODE) === null && !signInWithCode(revoked, CODE, NOW).ok
      && !signInWithCode(made, 'ZZZZ-ZZZZ-ZZZZ', NOW).ok && !revokeInvite(made, user(s, 'mA'), CODE).ok
      && normalizeCode(' abcd-efgh-jklm ') === CODE;
  });
  check('Admin can add a shop; it starts with every product at 0; duplicates are refused', () => {
    const s = makeState();
    const r = addStore(s, user(s, 'admin'), { name: 'Whitefield', city: 'Bengaluru' });
    return r.ok && r.storeId === 'whitefield' && r.state.stock.whitefield.DAL.qty === 0 && r.state.stock.whitefield.GHEE.qty === 0
      && !addStore(r.state, user(s, 'admin'), { name: 'whitefield' }).ok
      && !addStore(s, user(s, 'buyer'), { name: 'Other' }).ok
      && isValidState(r.state);
  });

  // --- Data shape --------------------------------------------------------
  check('Stored data with negative stock or a wrong version is rejected', () => {
    const neg = makeState();
    neg.stock.A.DAL.qty = -1;
    const old = makeState();
    old.version = 1; // must be upgraded first
    const noInvites = makeState();
    delete noInvites.invites; // saved before invite codes existed
    const badInvites = makeState();
    badInvites.invites = [{ code: 1 }];
    return isValidState(makeState()) && !isValidState(neg) && !isValidState(old) && !isValidState(null)
      && isValidState(noInvites) && !isValidState(badInvites);
  });

  return results;
}

// Also check the shipped sample file, which needs fetch (so it is async).
export async function checkSampleData(url = 'data/sample-data.json') {
  const name = 'Sample data file is valid, English only, every product has a brand, one item comes from two brands, OK/Low/Out cases';
  try {
    const data = await (await fetch(url, { cache: 'no-store' })).json();
    const statuses = new Set(buildRows(data).map((r) => r.status));
    const englishOnly = data.products.every((p) => /^[\x20-\x7E]+$/.test(p.name) && /^[\x20-\x7E]+$/.test(p.brand));
    const twoBrands = data.products.some((p) => data.products.some((q) => q !== p && q.name === p.name && q.brand !== p.brand));
    const passed = isValidState(data) && data.stores.length === 3 && Array.isArray(data.invites) && data.invites.length === 0
      && englishOnly && twoBrands && statuses.has('OK') && statuses.has('Low') && statuses.has('Out');
    return { name, passed, error: passed ? '' : 'sample data does not match' };
  } catch (err) {
    return { name, passed: false, error: err.message };
  }
}
