// app.js: draws the screen and handles clicks. No business rules live here;
// every change goes through a function in inventory.js, which checks can()
// first. Hiding buttons the user may not press is only a convenience.

import {
  ROLE_LABELS,
  ACTION_LABELS,
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
  findProduct,
  findStore,
  isPositiveInt,
  defaultStoreFor,
} from './inventory.js';
import * as store from './store.js';
import { downloadRowsAsCsv } from './export.js';

const USER_KEY = 'inventorysync:userId'; // sessionStorage: one user per tab
const THEME_KEY = 'inventorysync:theme'; // localStorage: dark/light choice

const bs = window.bootstrap || null; // Bootstrap's JS bundle (from vendor/)
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

let state = null; // the whole saved data object
let currentUser = null;
const cart = new Map(); // sku -> qty, always for the signed-in manager's own store (kept in memory, per tab)
const filters = { query: '', storeId: 'all', status: 'all' };
let visibleRows = []; // rows currently shown in the table (also what CSV exports)
let modalContext = {}; // { storeId, sku } for the modal that is open
let modalReturnFocus = null; // where keyboard focus goes when the modal closes

const $ = (id) => document.getElementById(id);

// Redraws replace the table rows, so the focused button is a new element
// afterwards. A "focus key" describes the focused control (by id, or by its
// row action) so the same control can be focused again after the redraw.
function focusKeyOf(el) {
  if (!el || el === document.body) return null;
  if (el.id) return { id: el.id };
  if (el.dataset && el.dataset.action) {
    return { action: el.dataset.action, store: el.dataset.store, sku: el.dataset.sku };
  }
  return null;
}

function restoreFocus(key) {
  if (!key) return false;
  let el = null;
  if (key.id) {
    el = $(key.id);
  } else {
    const row = `[data-store="${CSS.escape(key.store)}"][data-sku="${CSS.escape(key.sku)}"]`;
    el = document.querySelector(`#stockBody button[data-action="${CSS.escape(key.action)}"]${row}`);
    // The same button may now be disabled (e.g. stock hit 0): use another one in that row.
    if (!el || el.disabled) el = document.querySelector(`#stockBody button${row}:not([disabled])`);
  }
  if (!el || el.disabled || el.offsetParent === null) return false;
  if (el !== document.activeElement) el.focus();
  return true;
}

// Build an element safely. Text always goes in via textContent, never as HTML,
// so product names typed by users cannot inject markup.
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function storeNameOf(storeId) {
  const s = findStore(state, storeId);
  return s ? s.name : storeId;
}

function userLabel(u) {
  const where = u.storeId ? storeNameOf(u.storeId) : 'all stores';
  return `${u.name}: ${ROLE_LABELS[u.role]}, ${where}`;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function showBanner(message, type = 'warning') {
  const alert = h('div', { class: `alert alert-${type} alert-dismissible`, role: 'alert' },
    message,
    h('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'alert', 'aria-label': 'Close' }));
  $('banner').append(alert);
}

function toast(message, type = 'success') {
  const isError = type === 'danger';
  const el = h('div', {
    class: `toast align-items-center text-bg-${type} border-0`,
    role: isError ? 'alert' : 'status',
    'aria-live': isError ? 'assertive' : 'polite',
    'aria-atomic': 'true',
  },
  h('div', { class: 'd-flex' },
    h('div', { class: 'toast-body' }, message),
    h('button', { type: 'button', class: 'btn-close btn-close-white me-2 m-auto', 'data-bs-dismiss': 'toast', 'aria-label': 'Close' })));
  $('toastArea').append(el);
  if (bs) {
    el.addEventListener('hidden.bs.toast', () => el.remove());
    bs.Toast.getOrCreateInstance(el, { delay: isError ? 6000 : 3500 }).show();
  } else {
    el.classList.add('show');
    setTimeout(() => el.remove(), 5000);
  }
}

function showErrors(boxId, errors) {
  const box = $(boxId);
  box.replaceChildren(
    h('p', { class: 'fw-semibold mb-1' }, 'Refused. Nothing was changed:'),
    h('ul', { class: 'mb-0' }, errors.map((e) => h('li', {}, e))));
  box.classList.remove('d-none');
}

function hideErrors(boxId) {
  const box = $(boxId);
  box.replaceChildren();
  box.classList.add('d-none');
}

// ---------------------------------------------------------------------------
// Writes: always re-read, apply a rule from inventory.js, save once
// ---------------------------------------------------------------------------

// Re-read the newest saved data so another tab's sale is never overwritten.
function refreshFromStorage() {
  const latest = store.readLatest();
  if (latest) {
    state = latest;
    if (currentUser) currentUser = state.users.find((u) => u.id === currentUser.id) || null;
  }
}

// apply(state) must return { ok, errors, state } from inventory.js.
// Returns true when the change was applied and saved.
function runWrite(apply, { errorBox, success }) {
  refreshFromStorage();
  const result = apply(state);
  if (!result.ok) {
    showErrors(errorBox, result.errors);
    render();
    return false;
  }
  const saved = store.save(result.state);
  if (!saved.ok) {
    showErrors(errorBox, [saved.error]);
    return false;
  }
  state = result.state;
  hideErrors(errorBox);
  render();
  toast(success, 'success');
  return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const focusKey = focusKeyOf(document.activeElement);
  const signedIn = Boolean(currentUser);
  $('signInScreen').classList.toggle('d-none', signedIn);
  $('appScreen').classList.toggle('d-none', !signedIn);
  $('userControls').classList.toggle('d-none', !signedIn);

  if (!signedIn) {
    renderSignIn();
  } else {
    renderUserSwitch();
    renderToolbar();
    renderCards();
    renderStoreFilter();
    renderTable();
    renderAlerts();
    renderCart();
  }

  // Keep keyboard focus on the same control after a redraw (a click, a save or a sync).
  restoreFocus(focusKey);
}

function renderSignIn() {
  const items = state.users.map((u) => h('button', {
    type: 'button',
    class: 'list-group-item list-group-item-action',
    'data-user-id': u.id,
  },
  h('span', { class: 'fw-semibold d-block' }, u.name),
  h('span', { class: 'small text-body-secondary' }, `${ROLE_LABELS[u.role]} · ${u.storeId ? storeNameOf(u.storeId) : 'all stores'}`)));
  $('signInList').replaceChildren(...items);
}

function renderUserSwitch() {
  const select = $('userSwitch');
  select.replaceChildren(...state.users.map((u) => h('option', { value: u.id }, userLabel(u))));
  select.value = currentUser.id;
}

function renderToolbar() {
  $('addProductBtn').classList.toggle('d-none', !can(currentUser, 'addProduct', null));
  const canSell = can(currentUser, 'sell', currentUser.storeId);
  $('cartWrap').classList.toggle('d-none', !canSell);
  $('cartToggle').classList.toggle('d-none', !canSell);
}

// The Store filter sets the scope for the cards, the alerts and the table.
function scopeName() {
  return filters.storeId === 'all' ? 'All stores' : storeNameOf(filters.storeId);
}

// The all-stores total only makes sense when every store is listed.
function showChainTotal() {
  return filters.storeId === 'all';
}

function renderCards() {
  const s = summarize(state, filters.storeId);
  $('summaryScope').textContent = scopeName();
  $('cardSkus').textContent = String(s.totalSkus);
  $('cardLow').textContent = String(s.low);
  $('cardOut').textContent = String(s.out);
  $('cardValue').textContent = inr.format(s.stockValue);
}

function renderStoreFilter() {
  const select = $('storeFilter');
  if (!state.stores.some((s) => s.id === filters.storeId)) filters.storeId = 'all';
  select.replaceChildren(
    h('option', { value: 'all' }, 'All stores'),
    ...state.stores.map((s) => h('option', { value: s.id }, s.name)));
  select.value = filters.storeId;
  $('statusFilter').value = filters.status;
  if ($('searchInput').value !== filters.query) $('searchInput').value = filters.query;
}

function statusBadge(status) {
  const cls = { OK: 'text-bg-success', Low: 'text-bg-warning', Out: 'text-bg-danger' }[status];
  return h('span', { class: `badge status-badge ${cls}` }, status);
}

// label is the short text on the button; fullLabel is read out by screen readers.
function actionButton(action, label, row, style, disabled = false, fullLabel = label) {
  return h('button', {
    type: 'button',
    class: `btn ${style}`,
    'data-action': action,
    'data-store': row.storeId,
    'data-sku': row.sku,
    'aria-label': `${fullLabel}: ${row.name} at ${row.storeName}`,
    disabled,
  }, label);
}

function rowElement(r) {
  const actions = [];
  if (can(currentUser, 'sell', r.storeId)) actions.push(actionButton('sell', 'Add to cart', r, 'btn-primary', r.qty === 0));
  if (can(currentUser, 'receive', r.storeId)) actions.push(actionButton('receive', 'Receive', r, 'btn-outline-primary'));
  if (can(currentUser, 'transfer', r.storeId)) actions.push(actionButton('transfer', 'Transfer', r, 'btn-outline-primary', r.qty === 0));
  if (can(currentUser, 'setReorder', r.storeId)) actions.push(actionButton('reorder', 'Reorder', r, 'btn-outline-secondary', false, 'Reorder level'));

  return h('tr', {},
    h('td', {}, r.storeName),
    h('td', {}, h('code', {}, r.sku)),
    h('td', { class: 'product-name' }, r.name),
    h('td', { class: 'text-end d-none d-xl-table-cell print-cell' }, inr.format(r.price)),
    h('td', { class: 'text-end qty-cell fw-semibold' }, r.qty),
    h('td', { class: 'text-end qty-cell d-none d-xl-table-cell print-cell' }, r.reorderLevel),
    h('td', { class: 'text-center' }, statusBadge(r.status)),
    h('td', { class: `text-end qty-cell chain-total-cell${showChainTotal() ? '' : ' d-none'}` }, r.chainTotal),
    h('td', { class: 'text-end d-none d-xl-table-cell print-cell' }, inr.format(r.value)),
    h('td', { class: 'actions-cell no-print' }, actions.length
      ? h('div', { class: 'btn-group btn-group-sm row-actions', role: 'group', 'aria-label': `Actions for ${r.name} at ${r.storeName}` }, actions)
      : h('span', { class: 'text-body-secondary small' }, 'View only')));
}

function renderTable() {
  const scopeRows = filterRows(buildRows(state), { storeId: filters.storeId });
  visibleRows = filterRows(scopeRows, filters);
  $('chainTotalHead').classList.toggle('d-none', !showChainTotal());
  const body = $('stockBody');
  if (visibleRows.length === 0) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: '10', class: 'text-center text-body-secondary py-4' }, 'No items match these filters.')));
  } else {
    body.replaceChildren(...visibleRows.map(rowElement));
  }
  $('rowCount').textContent = `Showing ${visibleRows.length} of ${scopeRows.length} items · ${scopeName()}`;

  const storeText = scopeName();
  const statusText = filters.status === 'all' ? 'All statuses' : filters.status;
  const searchText = filters.query ? ` · Search: "${filters.query}"` : '';
  $('printMeta').textContent = `Printed ${new Date().toLocaleString('en-IN')} by ${currentUser.name} · Store: ${storeText} · Status: ${statusText}${searchText}`;
}

function renderAlerts() {
  const alerts = alertsOf(state, filters.storeId);
  $('alertScope').textContent = scopeName();
  $('alertCount').textContent = String(alerts.length);
  const list = $('alertList');
  if (alerts.length === 0) {
    list.replaceChildren(h('li', { class: 'list-group-item text-body-secondary' }, `Nothing needs action at ${scopeName()}. All items are above their reorder level.`));
    return;
  }
  list.replaceChildren(...alerts.map((a) => h('li', { class: 'list-group-item d-flex gap-2 align-items-start' },
    statusBadge(a.status),
    h('div', {},
      h('div', { class: 'fw-semibold' }, a.name),
      h('div', { class: 'small text-body-secondary' }, `${a.storeName}: ${a.qty} left (reorder at ${a.reorderLevel})`)))));
}

function renderCart() {
  if (!can(currentUser, 'sell', currentUser.storeId)) return;
  const storeId = currentUser.storeId;
  $('cartHeading').textContent = `Cart · ${storeNameOf(storeId)}`;

  // Drop lines for products that no longer exist (e.g. after a reset).
  for (const sku of [...cart.keys()]) if (!findProduct(state, sku)) cart.delete(sku);

  const lines = [...cart].map(([sku, qty]) => {
    const p = findProduct(state, sku);
    const inStock = state.stock[storeId][sku].qty;
    const inputId = `cartQty-${sku}`;
    return h('li', { class: 'border-bottom pb-2 mb-2' },
      h('div', { class: 'd-flex justify-content-between gap-2' },
        h('label', { for: inputId, class: 'fw-semibold' }, p.name),
        h('button', { type: 'button', class: 'btn btn-sm btn-link text-danger p-0', 'data-remove': sku, 'aria-label': `Remove ${p.name} from cart` }, 'Remove')),
      h('div', { class: 'd-flex align-items-center gap-2 mt-1' },
        h('input', {
          id: inputId,
          type: 'number',
          class: `form-control form-control-sm cart-qty${isPositiveInt(qty) ? '' : ' is-invalid'}`,
          min: '1',
          step: '1',
          value: Number.isFinite(qty) ? String(qty) : '',
          'data-sku': sku,
          inputmode: 'numeric',
          'aria-describedby': `${inputId}-help`,
        }),
        h('span', { id: `${inputId}-help`, class: 'small text-body-secondary' }, `${inStock} in stock · ${inr.format(p.price)} each`)));
  });

  $('cartLines').replaceChildren(...lines);
  $('cartEmpty').classList.toggle('d-none', cart.size > 0);
  $('checkoutBtn').disabled = cart.size === 0;
  $('clearCartBtn').disabled = cart.size === 0;
  updateCartTotals();
}

function updateCartTotals() {
  let total = 0;
  let count = 0;
  for (const [sku, qty] of cart) {
    const p = findProduct(state, sku);
    if (p && isPositiveInt(qty)) {
      total += p.price * qty;
      count += qty;
    }
  }
  $('cartTotal').textContent = inr.format(total);
  $('cartCount').textContent = String(count);
}

// ---------------------------------------------------------------------------
// Cart and checkout (R1)
// ---------------------------------------------------------------------------

function addToCart(storeId, sku) {
  refreshFromStorage();
  if (!can(currentUser, 'sell', storeId)) {
    toast(`${currentUser.name} is not allowed to ${ACTION_LABELS.sell} at ${storeNameOf(storeId)}.`, 'danger');
    return;
  }
  const inStock = state.stock[storeId][sku].qty;
  const wanted = (isPositiveInt(cart.get(sku)) ? cart.get(sku) : 0) + 1;
  if (wanted > inStock) {
    toast(`Only ${inStock} of ${findProduct(state, sku).name} in stock.`, 'danger');
    render();
    return;
  }
  cart.set(sku, wanted);
  hideErrors('cartErrors');
  render();
  toast(`Added ${findProduct(state, sku).name} (cart has ${wanted}).`);
}

function onCheckout() {
  const storeId = currentUser.storeId;
  const lines = [...cart].map(([sku, qty]) => ({ sku, qty }));
  // checkout() checks every line against the freshly re-read stock and either
  // applies all of them or none. runWrite saves once on success.
  const ok = runWrite((s) => checkout(s, currentUser, storeId, lines), {
    errorBox: 'cartErrors',
    success: `Sale recorded at ${storeNameOf(storeId)}.`,
  });
  if (ok) {
    cart.clear();
    renderCart();
    const panel = bs && bs.Offcanvas.getInstance($('cartPanel'));
    if (panel) panel.hide();
  }
}

// ---------------------------------------------------------------------------
// Modals: Receive, Transfer, Reorder level, Add product
// ---------------------------------------------------------------------------

// returnFocus is the focus key of the control that opened the modal. The
// table is redrawn while the modal is open, so the original button element
// may be gone by the time it closes.
function openModal(modalId, formId, errorBoxId, returnFocus) {
  if (!bs) {
    toast('Bootstrap JavaScript is missing from vendor/, so dialogs cannot open. See README.', 'danger');
    return;
  }
  const form = $(formId);
  form.reset();
  form.classList.remove('was-validated');
  hideErrors(errorBoxId);
  modalReturnFocus = returnFocus;
  bs.Modal.getOrCreateInstance($(modalId)).show();
}

// Focus the first field when a modal opens, and hand focus back to the
// opening button as soon as it starts closing (before Bootstrap hides the
// modal from screen readers, so focus is never left inside a hidden element).
function bindModalFocus(modalId) {
  const modal = $(modalId);
  modal.addEventListener('shown.bs.modal', () => {
    const field = modal.querySelector('.modal-body input, .modal-body select');
    if (field) field.focus();
  });
  modal.addEventListener('hide.bs.modal', () => {
    // Wait one tick: Bootstrap releases its focus trap right after this event.
    setTimeout(() => {
      if (!restoreFocus(modalReturnFocus) && modal.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      modalReturnFocus = null;
    }, 0);
  });
}

function closeModal(modalId) {
  if (bs) bs.Modal.getOrCreateInstance($(modalId)).hide();
}

function describe(storeId, sku) {
  const p = findProduct(state, sku);
  const entry = state.stock[storeId][sku];
  return `${p.name} (${sku}) at ${storeNameOf(storeId)}: ${entry.qty} in stock, reorder at ${entry.reorderLevel}.`;
}

function openReceive(storeId, sku) {
  modalContext = { storeId, sku };
  openModal('receiveModal', 'receiveForm', 'receiveErrors', { action: 'receive', store: storeId, sku });
  $('receiveContext').textContent = describe(storeId, sku);
}

function openTransfer(storeId, sku) {
  modalContext = { storeId, sku };
  openModal('transferModal', 'transferForm', 'transferErrors', { action: 'transfer', store: storeId, sku });
  const available = state.stock[storeId][sku].qty;
  $('transferContext').textContent = `From ${describe(storeId, sku)}`;
  $('transferTo').replaceChildren(
    h('option', { value: '' }, 'Choose a store…'),
    ...state.stores.filter((s) => s.id !== storeId).map((s) =>
      h('option', { value: s.id }, `${s.name} (has ${state.stock[s.id][sku].qty})`)));
  $('transferQty').max = String(available);
  $('transferQtyFeedback').textContent = `Enter a whole number from 1 to ${available}.`;
}

function openReorder(storeId, sku) {
  modalContext = { storeId, sku };
  openModal('reorderModal', 'reorderForm', 'reorderErrors', { action: 'reorder', store: storeId, sku });
  $('reorderContext').textContent = describe(storeId, sku);
  $('reorderLevel').value = String(state.stock[storeId][sku].reorderLevel);
}

// Bootstrap validation first (was-validated shows invalid-feedback), then the
// rule function decides. Returns false if the browser-side check failed.
function formIsValid(form) {
  form.classList.add('was-validated');
  return form.checkValidity();
}

function onReceiveSubmit(event) {
  event.preventDefault();
  if (!formIsValid(event.currentTarget)) return;
  const { storeId, sku } = modalContext;
  const qty = Number($('receiveQty').value);
  const ok = runWrite((s) => receive(s, currentUser, storeId, sku, qty), {
    errorBox: 'receiveErrors',
    success: `Received ${qty} × ${findProduct(state, sku).name} at ${storeNameOf(storeId)}.`,
  });
  if (ok) closeModal('receiveModal');
}

function onTransferSubmit(event) {
  event.preventDefault();
  if (!formIsValid(event.currentTarget)) return;
  const { storeId: fromId, sku } = modalContext;
  const toId = $('transferTo').value;
  const qty = Number($('transferQty').value);
  const ok = runWrite((s) => transfer(s, currentUser, fromId, toId, sku, qty), {
    errorBox: 'transferErrors',
    success: `Moved ${qty} × ${findProduct(state, sku).name} from ${storeNameOf(fromId)} to ${storeNameOf(toId)}.`,
  });
  if (ok) closeModal('transferModal');
}

function onReorderSubmit(event) {
  event.preventDefault();
  if (!formIsValid(event.currentTarget)) return;
  const { storeId, sku } = modalContext;
  const level = Number($('reorderLevel').value);
  const ok = runWrite((s) => setReorderLevel(s, currentUser, storeId, sku, level), {
    errorBox: 'reorderErrors',
    success: `Reorder level for ${findProduct(state, sku).name} at ${storeNameOf(storeId)} is now ${level}.`,
  });
  if (ok) closeModal('reorderModal');
}

function onProductSubmit(event) {
  event.preventDefault();
  if (!formIsValid(event.currentTarget)) return;
  const input = {
    sku: $('productSku').value,
    name: $('productName').value,
    price: Number($('productPrice').value),
    reorderLevel: Number($('productReorder').value),
  };
  const ok = runWrite((s) => addProduct(s, currentUser, input), {
    errorBox: 'productErrors',
    success: `Added product ${input.sku.trim().toUpperCase()}.`,
  });
  if (ok) closeModal('productModal');
}

// ---------------------------------------------------------------------------
// Users and theme
// ---------------------------------------------------------------------------

function signIn(userId) {
  currentUser = state.users.find((u) => u.id === userId) || null;
  try {
    if (currentUser) sessionStorage.setItem(USER_KEY, currentUser.id);
    else sessionStorage.removeItem(USER_KEY);
  } catch {
    // sessionStorage blocked: the user simply has to pick again after a refresh
  }
  cart.clear();
  hideErrors('cartErrors');
  resetFilters();
  render();
}

// Start each user on their own view: a manager sees their store, the buyer all stores.
function resetFilters() {
  filters.query = '';
  filters.status = 'all';
  filters.storeId = defaultStoreFor(currentUser);
}

function restoreUser() {
  let id = null;
  try {
    id = sessionStorage.getItem(USER_KEY);
  } catch {
    id = null;
  }
  currentUser = state.users.find((u) => u.id === id) || null;
  resetFilters();
}

function initTheme() {
  const btn = $('themeToggle');
  const root = document.documentElement;
  // The label names the mode the button switches to.
  const update = () => {
    btn.textContent = root.getAttribute('data-bs-theme') === 'dark' ? 'Light mode' : 'Dark mode';
  };
  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-bs-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // choice is not remembered, but the toggle still works
    }
    update();
  });
  // Follow OS changes only while the user has not picked a theme.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      let saved = null;
      try {
        saved = localStorage.getItem(THEME_KEY);
      } catch {
        saved = null;
      }
      if (!saved) {
        root.setAttribute('data-bs-theme', e.matches ? 'dark' : 'light');
        update();
      }
    });
  }
  update();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  $('signInList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-user-id]');
    if (btn) signIn(btn.dataset.userId);
  });
  $('userSwitch').addEventListener('change', (e) => signIn(e.target.value));
  $('signOutBtn').addEventListener('click', () => signIn(null));

  $('resetBtn').addEventListener('click', async () => {
    if (!window.confirm('Reset all data to the sample? Every change in this browser will be lost.')) return;
    try {
      const { state: fresh, notice } = await store.reset();
      state = fresh;
      if (currentUser) currentUser = state.users.find((u) => u.id === currentUser.id) || null;
      cart.clear();
      render();
      if (notice) showBanner(notice);
      else toast('Sample data restored.');
    } catch (err) {
      toast(`Reset failed: ${err.message}`, 'danger');
    }
  });

  // Filters (R9)
  $('filterForm').addEventListener('submit', (e) => e.preventDefault());
  $('searchInput').addEventListener('input', (e) => {
    filters.query = e.target.value;
    renderTable();
  });
  // The store filter changes the cards and alerts too, so redraw everything.
  $('storeFilter').addEventListener('change', (e) => {
    filters.storeId = e.target.value;
    render();
  });
  $('statusFilter').addEventListener('change', (e) => {
    filters.status = e.target.value;
    renderTable();
  });
  $('clearFilters').addEventListener('click', () => {
    filters.query = '';
    filters.storeId = 'all';
    filters.status = 'all';
    render();
  });

  // Export (R10): exactly the rows currently in the table.
  $('exportBtn').addEventListener('click', () => {
    if (visibleRows.length === 0) {
      toast('No rows to export with these filters.', 'danger');
      return;
    }
    downloadRowsAsCsv(visibleRows, { includeChainTotal: showChainTotal() });
    toast(`Exported ${visibleRows.length} rows to CSV.`);
  });
  $('printBtn').addEventListener('click', () => {
    renderTable(); // refresh the "Printed …" line
    window.print();
  });

  // Row buttons
  $('stockBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, store: storeId, sku } = btn.dataset;
    if (action === 'sell') addToCart(storeId, sku);
    else if (action === 'receive') openReceive(storeId, sku);
    else if (action === 'transfer') openTransfer(storeId, sku);
    else if (action === 'reorder') openReorder(storeId, sku);
  });

  $('addProductBtn').addEventListener('click', () => openModal('productModal', 'productForm', 'productErrors', { id: 'addProductBtn' }));

  // Cart
  $('cartLines').addEventListener('input', (e) => {
    const input = e.target.closest('input[data-sku]');
    if (!input) return;
    const qty = input.value === '' ? NaN : Number(input.value);
    cart.set(input.dataset.sku, qty);
    input.classList.toggle('is-invalid', !isPositiveInt(qty));
    updateCartTotals();
  });
  $('cartLines').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    cart.delete(btn.dataset.remove);
    renderCart();
    $('cartHeading').focus();
  });
  $('checkoutBtn').addEventListener('click', onCheckout);
  $('clearCartBtn').addEventListener('click', () => {
    cart.clear();
    hideErrors('cartErrors');
    renderCart();
  });

  for (const id of ['receiveModal', 'transferModal', 'reorderModal', 'productModal']) bindModalFocus(id);
  $('receiveForm').addEventListener('submit', onReceiveSubmit);
  $('transferForm').addEventListener('submit', onTransferSubmit);
  $('reorderForm').addEventListener('submit', onReorderSubmit);
  $('productForm').addEventListener('submit', onProductSubmit);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
  window.inventorySyncStarted = true; // read by the safety-net script in index.html
  initTheme();
  if (!bs) {
    showBanner('Bootstrap 5.3.8 files were not found in vendor/bootstrap/. Layout, dialogs and the cart panel need them. See README → Setup.', 'danger');
  }
  try {
    const { state: loaded, notice } = await store.load();
    state = loaded;
    if (notice) showBanner(notice);
  } catch (err) {
    const hint = location.protocol === 'file:'
      ? ' Open the app through a local web server (VS Code Live Server at http://localhost:5500), not by double-clicking the file.'
      : '';
    showBanner(`Could not load data: ${err.message}.${hint}`, 'danger');
    return;
  }

  $('cartHeading').setAttribute('tabindex', '-1');
  restoreUser();
  bindEvents();

  // R4: when another tab saves, take its data and redraw (no save here, so no loop).
  store.subscribe((fresh) => {
    state = fresh;
    if (currentUser) currentUser = state.users.find((u) => u.id === currentUser.id) || null;
    render();
  });

  render();
}

start();
