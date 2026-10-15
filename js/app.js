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
  setSelling,
  buildRows,
  filterRows,
  summarize,
  alertsOf,
  findProduct,
  findStore,
  isPositiveInt,
  defaultStoreFor,
  userFromInvite,
  signInWithCode,
  normalizeCode,
  productLabel,
} from './inventory.js';
import * as store from './store.js';
import { downloadRowsAsCsv } from './export.js';
import { bs, inr, $, h, showBanner, toast, showErrors, hideErrors, initTheme } from './ui.js';

// sessionStorage: the invite code this tab signed in with. The shop's "user"
// is worked out from that code on every redraw, so revoking a code in the
// admin page signs the shop out straight away.
const CODE_KEY = 'inventorysync:inviteCode';

let state = null; // the whole saved data object
let signedInCode = null;
let currentUser = null;
const cart = new Map(); // sku -> qty, always for the signed-in manager's own store (kept in memory, per tab)
const filters = { query: '', storeId: 'all', status: 'all' };
let visibleRows = []; // rows currently shown in the table (also what CSV exports)
let modalContext = {}; // { storeId, sku } for the modal that is open
let modalReturnFocus = null; // where keyboard focus goes when the modal closes

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

function storeNameOf(storeId) {
  const s = findStore(state, storeId);
  return s ? s.name : storeId;
}

function userLabel(u) {
  const where = u.storeId ? storeNameOf(u.storeId) : 'all stores';
  return `${u.name} · ${ROLE_LABELS[u.role]}, ${where}`;
}

// ---------------------------------------------------------------------------
// Writes: always re-read, apply a rule from inventory.js, save once
// ---------------------------------------------------------------------------

// Re-read the newest saved data so another tab's sale is never overwritten.
function refreshFromStorage() {
  const latest = store.readLatest();
  if (latest) {
    state = latest;
    currentUser = signedInCode ? userFromInvite(state, signedInCode) : null;
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

  if (signedIn) {
    renderWho();
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

// Signed-in shop shown in the navbar (no user switcher: each shop signs in
// with its own invite code).
function renderWho() {
  $('whoAmI').textContent = userLabel(currentUser);
}

function renderToolbar() {
  $('addProductBtn').classList.toggle('d-none', !can(currentUser, 'addProduct', null));
  const canSell = can(currentUser, 'sell', currentUser.storeId);
  $('cartWrap').classList.toggle('d-none', !canSell);
  $('cartToggle').classList.toggle('d-none', !canSell);

  // One click lists the items this shop has stopped selling; again goes back.
  const canStop = can(currentUser, 'setSelling', currentUser.storeId);
  const btn = $('stoppedBtn');
  btn.classList.toggle('d-none', !canStop);
  if (canStop) {
    const showing = filters.status === 'Stopped';
    const count = summarize(state, currentUser.storeId).stopped;
    btn.textContent = showing ? 'Show items on sale' : `Stopped selling (${count})`;
    btn.setAttribute('aria-pressed', String(showing));
  }
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
  const cls = { OK: 'text-bg-success', Low: 'text-bg-warning', Out: 'text-bg-danger', Stopped: 'text-bg-secondary' }[status];
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
    'aria-label': `${fullLabel}: ${productLabel(row)} at ${row.storeName}`,
    disabled,
  }, label);
}

function rowElement(r) {
  const actions = [];
  if (can(currentUser, 'sell', r.storeId) && !r.stopped) actions.push(actionButton('sell', 'Add to cart', r, 'btn-primary', r.qty === 0));
  if (can(currentUser, 'receive', r.storeId)) actions.push(actionButton('receive', 'Receive', r, 'btn-outline-primary'));
  if (can(currentUser, 'transfer', r.storeId)) actions.push(actionButton('transfer', 'Transfer', r, 'btn-outline-primary', r.qty === 0));
  if (can(currentUser, 'setReorder', r.storeId)) actions.push(actionButton('reorder', 'Reorder', r, 'btn-outline-secondary', false, 'Reorder level'));
  if (can(currentUser, 'setSelling', r.storeId)) {
    actions.push(r.stopped
      ? actionButton('resume', 'Resume', r, 'btn-outline-success', false, 'Resume selling')
      : actionButton('stop', 'Stop', r, 'btn-outline-secondary', false, 'Stop selling'));
  }

  return h('tr', { class: r.stopped ? 'row-stopped' : null },
    h('td', {}, r.storeName),
    h('td', {}, h('code', {}, r.sku)),
    // Product name with its brand underneath (the same item can come from several brands).
    h('td', { class: 'product-name' },
      h('div', {}, r.name),
      h('div', { class: 'product-brand' }, r.brand)),
    h('td', { class: 'text-end d-none d-xl-table-cell print-cell' }, inr.format(r.price)),
    h('td', { class: 'text-end qty-cell fw-semibold' }, r.qty),
    h('td', { class: 'text-end qty-cell d-none d-xl-table-cell print-cell' }, r.reorderLevel),
    h('td', { class: 'text-center' }, statusBadge(r.status)),
    h('td', { class: `text-end qty-cell chain-total-cell${showChainTotal() ? '' : ' d-none'}` }, r.chainTotal),
    h('td', { class: 'text-end d-none d-xl-table-cell print-cell' }, inr.format(r.value)),
    h('td', { class: 'actions-cell no-print' }, actions.length
      ? h('div', { class: 'btn-group btn-group-sm row-actions', role: 'group', 'aria-label': `Actions for ${productLabel(r)} at ${r.storeName}` }, actions)
      : h('span', { class: 'text-body-secondary small' }, 'View only')));
}

function renderTable() {
  // Every row of the chosen store (including stopped items); the filters
  // then pick what is shown.
  const scopeRows = buildRows(state).filter((r) => filters.storeId === 'all' || r.storeId === filters.storeId);
  visibleRows = filterRows(scopeRows, filters);
  $('chainTotalHead').classList.toggle('d-none', !showChainTotal());
  const body = $('stockBody');
  if (visibleRows.length === 0) {
    const message = filters.status === 'Stopped'
      ? 'This shop has not stopped selling any items. Use "Stop" on a row to stop selling an item.'
      : 'No items match these filters.';
    body.replaceChildren(h('tr', {}, h('td', { colspan: '10', class: 'text-center text-body-secondary py-4' }, message)));
  } else {
    body.replaceChildren(...visibleRows.map(rowElement));
  }
  $('rowCount').textContent = `Showing ${visibleRows.length} of ${scopeRows.length} items · ${scopeName()}`;

  const storeText = scopeName();
  const statusText = { all: 'All items on sale', Stopped: 'Stopped selling' }[filters.status] || filters.status;
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
      h('div', { class: 'small text-body-secondary' }, `${a.brand} · ${a.storeName}: ${a.qty} left (reorder at ${a.reorderLevel})`)))));
}

function renderCart() {
  if (!can(currentUser, 'sell', currentUser.storeId)) return;
  const storeId = currentUser.storeId;
  $('cartHeading').textContent = `Cart · ${storeNameOf(storeId)}`;

  // Drop lines for products that no longer exist (e.g. after a reset).
  for (const sku of [...cart.keys()]) if (!findProduct(state, sku)) cart.delete(sku);

  // Each item: name and line total on top; quantity, stock and Remove below.
  const lines = [...cart].map(([sku, qty]) => {
    const p = findProduct(state, sku);
    const inStock = state.stock[storeId][sku].qty;
    const inputId = `cartQty-${sku}`;
    return h('li', { class: 'cart-line' },
      h('div', { class: 'cart-line-top' },
        h('label', { for: inputId, class: 'cart-line-name' }, p.name, h('span', { class: 'product-brand' }, p.brand)),
        h('span', { class: 'cart-line-total', 'data-line-total': sku }, lineTotalText(p, qty))),
      h('div', { class: 'cart-line-bottom' },
        h('input', {
          id: inputId,
          type: 'number',
          class: `form-control form-control-sm cart-qty${isPositiveInt(qty) ? '' : ' is-invalid'}`,
          min: '1',
          max: String(inStock),
          step: '1',
          value: Number.isFinite(qty) ? String(qty) : '',
          'data-sku': sku,
          inputmode: 'numeric',
          'aria-describedby': `${inputId}-help`,
        }),
        h('span', { id: `${inputId}-help`, class: 'cart-line-help' }, `of ${inStock} · ${inr.format(p.price)} each`),
        h('button', {
          type: 'button',
          class: 'btn btn-sm btn-outline-danger cart-line-remove',
          'data-remove': sku,
          'aria-label': `Remove ${productLabel(p)} from cart`,
        }, 'Remove')));
  });

  $('cartLines').replaceChildren(...lines);
  $('cartEmpty').classList.toggle('d-none', cart.size > 0);
  $('checkoutBtn').disabled = cart.size === 0;
  $('clearCartBtn').disabled = cart.size === 0;
  updateCartTotals();
}

// Price × quantity for one cart item, or a dash while the quantity is invalid.
function lineTotalText(product, qty) {
  return isPositiveInt(qty) ? inr.format(product.price * qty) : '–';
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
    const cell = document.querySelector(`[data-line-total="${CSS.escape(sku)}"]`);
    if (cell && p) cell.textContent = lineTotalText(p, qty);
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
    toast(`Only ${inStock} of ${productLabel(findProduct(state, sku))} in stock.`, 'danger');
    render();
    return;
  }
  cart.set(sku, wanted);
  hideErrors('cartErrors');
  render();
  toast(`Added ${productLabel(findProduct(state, sku))} (cart has ${wanted}).`);
}

// One click, no dialog: stop or resume selling an item at this shop.
function onSetSelling(storeId, sku, selling) {
  const name = productLabel(findProduct(state, sku));
  // A stopped item cannot stay in the cart.
  if (!selling) cart.delete(sku);
  runWrite((s) => setSelling(s, currentUser, storeId, sku, selling), {
    errorBox: 'cartErrors',
    success: selling ? `${name} is on sale again at ${storeNameOf(storeId)}.` : `Stopped selling ${name} at ${storeNameOf(storeId)}. Find it under "Stopped selling".`,
  });
  // The row moved to the other list, so keep keyboard focus on the list button.
  if (document.activeElement === document.body || !document.activeElement) $('stoppedBtn').focus();
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
  return `${productLabel(p)}, SKU ${sku}, at ${storeNameOf(storeId)}: ${entry.qty} in stock, reorder at ${entry.reorderLevel}.`;
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
    success: `Received ${qty} × ${productLabel(findProduct(state, sku))} at ${storeNameOf(storeId)}.`,
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
    success: `Moved ${qty} × ${productLabel(findProduct(state, sku))} from ${storeNameOf(fromId)} to ${storeNameOf(toId)}.`,
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
    success: `Reorder level for ${productLabel(findProduct(state, sku))} at ${storeNameOf(storeId)} is now ${level}.`,
  });
  if (ok) closeModal('reorderModal');
}

function onProductSubmit(event) {
  event.preventDefault();
  if (!formIsValid(event.currentTarget)) return;
  const input = {
    sku: $('productSku').value,
    name: $('productName').value,
    brand: $('productBrand').value,
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

// Shop sign-in with an invite code from head office.
function onSignInSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;
  refreshFromStorage(); // a code created a moment ago in the admin tab must work
  const code = normalizeCode($('inviteCode').value);
  const result = signInWithCode(state, code, new Date().toISOString());
  if (!result.ok) {
    showErrors('signInErrors', result.errors);
    $('inviteCode').focus();
    return;
  }
  const saved = store.save(result.state);
  if (!saved.ok) {
    showErrors('signInErrors', [saved.error]);
    return;
  }
  state = result.state;
  signedInCode = code;
  currentUser = result.user;
  try {
    sessionStorage.setItem(CODE_KEY, code);
  } catch {
    // sessionStorage blocked: the shop has to sign in again after a refresh
  }
  form.reset();
  form.classList.remove('was-validated');
  hideErrors('signInErrors');
  cart.clear();
  resetFilters();
  render();
  toast(`Signed in as ${currentUser.name}.`);
}

function signOut(message) {
  signedInCode = null;
  currentUser = null;
  try {
    sessionStorage.removeItem(CODE_KEY);
  } catch {
    // nothing to remove
  }
  cart.clear();
  hideErrors('cartErrors');
  render();
  if (message) showErrors('signInErrors', [message]);
  $('inviteCode').focus();
}

// Start each user on their own view: a manager sees their store, the buyer all stores.
function resetFilters() {
  filters.query = '';
  filters.status = 'all';
  filters.storeId = defaultStoreFor(currentUser);
}

function restoreUser() {
  try {
    signedInCode = sessionStorage.getItem(CODE_KEY);
  } catch {
    signedInCode = null;
  }
  currentUser = signedInCode ? userFromInvite(state, signedInCode) : null;
  if (!currentUser) signedInCode = null;
  resetFilters();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  $('signInForm').addEventListener('submit', onSignInSubmit);
  $('signOutBtn').addEventListener('click', () => signOut());

  // One click: list only the items this shop has stopped selling (or go back).
  $('stoppedBtn').addEventListener('click', () => {
    filters.status = filters.status === 'Stopped' ? 'all' : 'Stopped';
    if (filters.status === 'Stopped') filters.storeId = currentUser.storeId;
    render();
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
    render(); // also updates the Stopped selling button
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
    else if (action === 'stop') onSetSelling(storeId, sku, false);
    else if (action === 'resume') onSetSelling(storeId, sku, true);
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
    const wasSignedIn = Boolean(currentUser);
    currentUser = signedInCode ? userFromInvite(state, signedInCode) : null;
    if (wasSignedIn && !currentUser) {
      signOut('Your invite code is no longer active. Ask head office for a new one.');
      return;
    }
    render();
  });

  render();
}

start();
