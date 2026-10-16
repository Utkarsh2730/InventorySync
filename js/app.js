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
  findAccount,
  normalizeLoginId,
  userFromSession,
  signInAccount,
  changeOwnPassword,
  disableAllAccounts,
  productLabel,
  ADMIN_LOGIN_ID,
} from './inventory.js';
import * as store from './store.js';
import { downloadRowsAsCsv } from './export.js';
import { bs, inr, $, h, showBanner, toast, showErrors, hideErrors, initTheme } from './ui.js';
import { hashForAccount, isCryptoAvailable, makePasswordRecord, MIN_PASSWORD_LENGTH } from './crypto.js';
import { ADMIN_USER, hasAdminPasscode, hashAdminPasscode, saveAdminPasscode, clearAdminPasscode, isAdminSession } from './admin-auth.js';

// sessionStorage: { loginId, hash } of the login this tab signed in with.
// The user is worked out from it on every redraw, so a disabled login or a
// changed password signs other tabs out straight away.
//
// Everyone signs in on the same screen. The head-office admin uses the Shop
// ID "admin" and the admin passcode; there is no separate admin page and no
// visible admin option. The admin's "Shops & logins" view (admin-panel.js)
// is only loaded after the admin signs in.
const SESSION_KEY = 'inventorysync:shopSession';

let state = null; // the whole saved data object
let session = null; // { loginId, hash } or null
let currentUser = null;

// The admin's own address: /admin (and the old /admin.html) open this page
// with #admin, which shows "Admin sign in" with the Shop ID filled in.
// Shops opening / never see it.
function isAdminAddress() {
  return location.hash === '#admin';
}

let adminPanel = null; // loaded on first use by the admin
const cart = new Map(); // sku -> qty, always for the signed-in manager's own store (kept in memory, per tab)
const filters = { query: '', storeId: 'all', status: 'all' };
let visibleRows = []; // rows matching the filters (also what CSV exports and Print shows)
const ROW_STEP = 200; // the table draws this many rows at a time; "Show more" adds the next batch
let rowLimit = ROW_STEP;
let renderQueued = false;
let searchTimer = 0;
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

// Who this tab is signed in as: a shop or head-office login from the shared
// data, or the admin (checked against the admin passcode).
function resolveUser() {
  if (!session) return null;
  if (session.loginId === ADMIN_LOGIN_ID) return isAdminSession(session.hash) ? ADMIN_USER : null;
  return userFromSession(state, session.loginId, session.hash);
}

function isAdmin() {
  return Boolean(currentUser && currentUser.role === 'admin');
}

function saveSession(next) {
  session = next;
  try {
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // sessionStorage blocked: sign in again after a refresh
  }
}

// Re-read the newest saved data so another tab's sale is never overwritten.
function refreshFromStorage() {
  const latest = store.readLatest();
  if (latest && latest !== state) {
    state = latest;
    currentUser = resolveUser();
    scheduleRender(); // another tab's change is shown even if this action is refused
  }
}

// Many saves in a burst (other tabs, sync events) are drawn once per frame.
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// apply(state) must return { ok, errors, state } from inventory.js.
// Returns the result when the change was applied and saved, otherwise null.
function runWrite(apply, { errorBox, success }) {
  refreshFromStorage();
  const result = apply(state);
  if (!result.ok) {
    showErrors(errorBox, result.errors);
    render();
    return null;
  }
  const saved = store.save(result.state);
  if (!saved.ok) {
    showErrors(errorBox, [saved.error]);
    return null;
  }
  state = result.state;
  hideErrors(errorBox);
  render();
  if (success) toast(success, 'success');
  return result;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const focusKey = focusKeyOf(document.activeElement);
  const signedIn = Boolean(currentUser);
  const managing = signedIn && isAdmin(); // the admin portal is Shops & logins only, no stock
  $('signInScreen').classList.toggle('d-none', signedIn);
  $('appScreen').classList.toggle('d-none', !signedIn || managing);
  $('manageScreen').classList.toggle('d-none', !managing);
  $('userControls').classList.toggle('d-none', !signedIn);
  if (!signedIn) renderPortalLook(); // back to the shop look after signing out

  if (managing) {
    renderWho();
    renderManage();
  } else if (signedIn) {
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
// with its own Shop ID and password).
function renderWho() {
  $('whoAmI').textContent = isAdmin() ? 'Admin · head office' : userLabel(currentUser);
  renderPortalLook();
  // Remind a shop to replace a password made by head office.
  const account = !isAdmin() && session ? findAccount(state, session.loginId) : null;
  $('tempPasswordNotice').classList.toggle('d-none', !(account && account.tempPassword));
}

// The admin portal looks different from the shop portal: dark navbar, an
// "Admin portal" badge and its own tab title. Shops keep the light navbar.
function renderPortalLook() {
  const admin = isAdmin();
  const nav = $('mainNav');
  nav.classList.toggle('bg-body-tertiary', !admin);
  nav.classList.toggle('bg-dark', admin);
  if (admin) nav.setAttribute('data-bs-theme', 'dark');
  else nav.removeAttribute('data-bs-theme');
  $('portalBadge').textContent = admin ? 'Admin portal' : '';
  $('portalBadge').classList.toggle('d-none', !admin);
  document.title = admin ? 'InventorySync Admin' : 'InventorySync: multi-store stock and alerts';
}

// The admin's Shops & logins view, loaded the first time it is opened.
function renderManage() {
  if (adminPanel) {
    adminPanel.render();
    return;
  }
  import('./admin-panel.js').then(({ createAdminPanel }) => {
    if (adminPanel || !isAdmin()) return;
    adminPanel = createAdminPanel({
      container: $('manageScreen'),
      getState: () => state,
      getUser: () => currentUser,
      write: runWrite,
      resetData,
    });
    if (isAdmin()) adminPanel.render();
  }).catch((err) => showBanner(`Could not open Shops & logins: ${err.message}`, 'danger'));
}

// Admin: restore the sample data (shops and logins are deleted).
async function resetData() {
  try {
    const { state: fresh, notice } = await store.reset();
    state = fresh;
    cart.clear();
    render();
    if (notice) showBanner(notice);
    else toast('Sample data restored.');
  } catch (err) {
    toast(`Reset failed: ${err.message}`, 'danger');
  }
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

// What the signed-in user may do at each store, worked out once per redraw
// instead of five times for every row.
function permissionsByStore() {
  const map = new Map();
  for (const st of state.stores) {
    map.set(st.id, {
      sell: can(currentUser, 'sell', st.id),
      receive: can(currentUser, 'receive', st.id),
      transfer: can(currentUser, 'transfer', st.id),
      reorder: can(currentUser, 'setReorder', st.id),
      setSelling: can(currentUser, 'setSelling', st.id),
    });
  }
  return map;
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

function rowElement(r, may, chainTotalClass) {
  const actions = [];
  if (may.sell && !r.stopped) actions.push(actionButton('sell', 'Add to cart', r, 'btn-primary', r.qty === 0));
  if (may.receive) actions.push(actionButton('receive', 'Receive', r, 'btn-outline-primary'));
  if (may.transfer) actions.push(actionButton('transfer', 'Transfer', r, 'btn-outline-primary', r.qty === 0));
  if (may.reorder) actions.push(actionButton('reorder', 'Reorder', r, 'btn-outline-secondary', false, 'Reorder level'));
  if (may.setSelling) {
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
    h('td', { class: chainTotalClass }, r.chainTotal),
    h('td', { class: 'text-end d-none d-xl-table-cell print-cell' }, inr.format(r.value)),
    h('td', { class: 'actions-cell no-print' }, actions.length
      ? h('div', { class: 'btn-group btn-group-sm row-actions', role: 'group', 'aria-label': `Actions for ${productLabel(r)} at ${r.storeName}` }, actions)
      : h('span', { class: 'text-body-secondary small' }, 'View only')));
}

function renderTable() {
  // Every row of the chosen store (including stopped items); the filters
  // then pick what is shown. buildRows is cached, so this is cheap.
  const allRows = buildRows(state);
  const scopeCount = filters.storeId === 'all' ? allRows.length : allRows.filter((r) => r.storeId === filters.storeId).length;
  visibleRows = filterRows(allRows, filters);
  $('chainTotalHead').classList.toggle('d-none', !showChainTotal());
  const body = $('stockBody');
  if (visibleRows.length === 0) {
    const message = filters.status === 'Stopped'
      ? 'This shop has not stopped selling any items. Use "Stop" on a row to stop selling an item.'
      : 'No items match these filters.';
    body.replaceChildren(h('tr', {}, h('td', { colspan: '10', class: 'text-center text-body-secondary py-4' }, message)));
  } else {
    // Long lists are drawn in batches so the page stays quick with thousands of items.
    const shown = visibleRows.slice(0, rowLimit);
    const may = permissionsByStore();
    const chainTotalClass = `text-end qty-cell chain-total-cell${showChainTotal() ? '' : ' d-none'}`;
    const rows = document.createDocumentFragment();
    for (const r of shown) rows.append(rowElement(r, may.get(r.storeId), chainTotalClass));
    const more = visibleRows.length - shown.length;
    if (more > 0) {
      rows.append(h('tr', { class: 'no-print' }, h('td', { colspan: '10', class: 'text-center py-2' },
        h('button', { type: 'button', id: 'showMoreRows', class: 'btn btn-sm btn-outline-secondary' },
          `Show ${Math.min(more, ROW_STEP)} more (${more} not shown)`))));
    }
    body.replaceChildren(rows);
  }
  $('rowCount').textContent = `Showing ${visibleRows.length} of ${scopeCount} items · ${scopeName()}`;
}

// The "Printed …" line is only needed when printing, so it is written then.
function renderPrintMeta() {
  if (!currentUser) return;
  const statusText = { all: 'All items on sale', Stopped: 'Stopped selling' }[filters.status] || filters.status;
  const searchText = filters.query ? ` · Search: "${filters.query}"` : '';
  $('printMeta').textContent = `Printed ${new Date().toLocaleString('en-IN')} by ${currentUser.name} · Store: ${scopeName()} · Status: ${statusText}${searchText}`;
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

// Sign-in for everyone: shops and head office with their Shop ID and
// password, the admin with the Shop ID "admin" and the admin passcode. The
// password is hashed here (crypto.js); inventory.js compares hashes.
async function onSignInSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const loginId = normalizeLoginId($('loginId').value);
  const password = $('loginPassword').value;
  const settingUp = loginId === ADMIN_LOGIN_ID && !hasAdminPasscode();
  // Checked here, not only by the minlength attribute (which browsers apply to typed text only).
  $('loginPassword').setCustomValidity(settingUp && password.length < MIN_PASSWORD_LENGTH ? `At least ${MIN_PASSWORD_LENGTH} characters.` : '');
  $('loginPasswordConfirm').setCustomValidity(settingUp && $('loginPasswordConfirm').value !== password ? 'Passwords do not match.' : '');
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;
  if (!isCryptoAvailable()) {
    showErrors('signInErrors', ['This page cannot check passwords here. Open it over https:// or from localhost.']);
    return;
  }
  const submit = $('signInSubmit');
  submit.disabled = true;
  try {
    if (loginId === ADMIN_LOGIN_ID) {
      // First time: the password typed (twice) becomes the admin passcode.
      const hash = settingUp ? await saveAdminPasscode(password) : await hashAdminPasscode(password);
      if (!isAdminSession(hash)) {
        failSignIn(['Wrong Shop ID or password.']);
        return;
      }
      saveSession({ loginId, hash });
      currentUser = ADMIN_USER;
    } else {
      refreshFromStorage(); // a login created a moment ago in another tab must work
      const account = findAccount(state, loginId);
      const hash = account ? await hashForAccount(password, account) : null;
      refreshFromStorage(); // hashing takes a moment; use the newest data
      const result = signInAccount(state, loginId, hash, new Date().toISOString());
      if (!result.ok) {
        failSignIn(result.errors);
        return;
      }
      const saved = store.save(result.state);
      if (!saved.ok) {
        failSignIn([saved.error]);
        return;
      }
      state = result.state;
      saveSession({ loginId, hash });
      currentUser = result.user;
    }
    form.reset();
    form.classList.remove('was-validated');
    hideErrors('signInErrors');
    updateSignInMode();
    closeForgotPanel();
    cart.clear();
    resetFilters();
    render();
    toast(`Signed in as ${currentUser.name}.`);
  } catch (err) {
    failSignIn([`Could not sign in: ${err.message}`]);
  } finally {
    submit.disabled = false;
  }
}

function failSignIn(errors) {
  showErrors('signInErrors', errors);
  $('loginPassword').value = '';
  $('loginPasswordConfirm').value = '';
  $('loginPassword').focus();
}

// The second password box appears only when the admin passcode is being
// chosen for the first time (Shop ID "admin" and no passcode yet).
function updateSignInMode() {
  const adminTyped = normalizeLoginId($('loginId').value) === ADMIN_LOGIN_ID;
  const settingUp = adminTyped && !hasAdminPasscode();
  // Reached through /admin: an admin sign-in. Otherwise the usual shop sign-in.
  const adminForm = isAdminAddress() && (adminTyped || !$('loginId').value.trim());
  $('signInHeading').textContent = adminForm ? 'Admin sign in' : 'Shop sign in';
  $('signInIntro').textContent = !adminForm
    ? 'Use the Shop ID and password your head office gave your shop.'
    : settingUp
      ? `No admin passcode is saved in this browser yet. Choose one (at least ${MIN_PASSWORD_LENGTH} characters) and type it twice. If you set one before, you are in a different browser or it was cleared.`
      : 'Enter the admin passcode.';
  $('confirmWrap').classList.toggle('d-none', !settingUp);
  $('loginPasswordConfirm').required = settingUp;
  $('loginPassword').minLength = settingUp ? MIN_PASSWORD_LENGTH : 0;
  $('loginPassword').autocomplete = settingUp ? 'new-password' : 'current-password';
  $('loginPasswordFeedback').textContent = settingUp ? `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` : 'Enter your password.';
  $('signInSubmit').textContent = settingUp ? 'Save password and sign in' : 'Sign in';
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

// Shops ask head office for a new password. The admin (Shop ID "admin") can
// start over: there is no server to prove who is asking, so this disables
// every shop login. Stock, shops and products are kept.
function renderForgotPanel() {
  const panel = $('forgotPanel');
  const adminTyped = normalizeLoginId($('loginId').value) === ADMIN_LOGIN_ID;
  if (adminTyped && !hasAdminPasscode()) {
    // Nothing to reset: no passcode is saved in this browser yet.
    panel.replaceChildren(h('p', { class: 'small mb-0' },
      'No admin passcode is saved in this browser, so there is nothing to reset. Choose a new one in the two password boxes above and sign in.'));
    return;
  }
  if (!adminTyped) {
    // At /admin, point the admin at the right Shop ID; shops at / only see the shop advice.
    panel.replaceChildren(h('p', { class: 'small mb-0' }, isAdminAddress()
      ? 'Type admin as the Shop ID to reset the admin passcode.'
      : 'Ask head office to reset your password. They will give you a new one, and you can then change it to one only you know.'));
    return;
  }
  panel.replaceChildren(h('form', { id: 'forgotForm', class: 'forgot-panel', novalidate: true },
    h('p', { class: 'small mb-2' },
      'The admin passcode is stored only in this browser and cannot be recovered. You can choose a new one, but to keep the shops safe ',
      h('strong', {}, 'every shop login will be disabled'),
      ' and shops are signed out. Afterwards you can enable each login again or reset its password. Stock, shops and products are kept.'),
    h('div', { id: 'forgotErrors', class: 'alert alert-danger d-none', role: 'alert' }),
    h('label', { for: 'forgotConfirm', class: 'form-label small' }, 'Type ', h('strong', {}, 'RESET'), ' to confirm'),
    h('div', { class: 'input-group' },
      h('input', { id: 'forgotConfirm', type: 'text', class: 'form-control', required: true, pattern: 'RESET', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }),
      h('button', { type: 'submit', class: 'btn btn-outline-danger' }, 'Disable logins and start over'))));
  $('forgotConfirm').addEventListener('input', (e) => e.currentTarget.setCustomValidity(''));
  $('forgotForm').addEventListener('submit', onForgotSubmit);
}

function closeForgotPanel() {
  $('forgotPanel').classList.add('d-none');
  $('forgotToggle').setAttribute('aria-expanded', 'false');
}

function onForgotSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  if ($('forgotConfirm').value.trim() !== 'RESET') {
    $('forgotConfirm').setCustomValidity('Type RESET to confirm.');
    return;
  }
  refreshFromStorage();
  const result = disableAllAccounts(state);
  const saved = store.save(result.state);
  if (!saved.ok) {
    showErrors('forgotErrors', [saved.error]);
    return;
  }
  state = result.state;
  clearAdminPasscode();
  closeForgotPanel();
  updateSignInMode();
  hideErrors('signInErrors');
  showBanner(`Admin passcode cleared and ${result.disabled} shop login${result.disabled === 1 ? '' : 's'} disabled. Sign in as "admin" with a new password, then enable each login again or reset its password.`, 'info');
  $('loginPassword').focus();
}

// ---------------------------------------------------------------------------
// Change password (shops, head office and the admin)
// ---------------------------------------------------------------------------

function openPasswordModal() {
  $('passwordContext').textContent = isAdmin()
    ? 'Change the admin passcode. Other tabs signed in as admin will be signed out.'
    : `Change the password for Shop ID ${session.loginId}. Other tabs signed in with the old password will be signed out.`;
  openModal('passwordModal', 'passwordForm', 'passwordErrors', { id: 'changePasswordBtn' });
}

async function onPasswordSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const current = $('currentPassword').value;
  const next = $('newPassword').value;
  $('newPassword').setCustomValidity(next.length < MIN_PASSWORD_LENGTH ? `At least ${MIN_PASSWORD_LENGTH} characters.`
    : next === current ? 'Choose a password different from the current one.' : '');
  $('confirmPassword').setCustomValidity($('confirmPassword').value !== next ? 'Passwords do not match.' : '');
  if (!formIsValid(form)) return;
  const submit = $('passwordSubmit');
  submit.disabled = true;
  try {
    if (isAdmin()) {
      if (!isAdminSession(await hashAdminPasscode(current))) {
        showErrors('passwordErrors', ['The current password is not right.']);
        return;
      }
      saveSession({ loginId: ADMIN_LOGIN_ID, hash: await saveAdminPasscode(next) });
    } else {
      refreshFromStorage();
      const account = findAccount(state, session.loginId);
      const currentHash = account ? await hashForAccount(current, account) : null;
      const record = await makePasswordRecord(next);
      refreshFromStorage();
      const result = changeOwnPassword(state, currentUser, currentHash, record);
      if (!result.ok) {
        showErrors('passwordErrors', result.errors);
        return;
      }
      // Keep this tab signed in with the new password before other tabs hear of it.
      saveSession({ loginId: session.loginId, hash: record.hash });
      const saved = store.save(result.state);
      if (!saved.ok) {
        saveSession({ loginId: session.loginId, hash: account.hash });
        showErrors('passwordErrors', [saved.error]);
        return;
      }
      state = result.state;
    }
    hideErrors('passwordErrors');
    closeModal('passwordModal');
    render();
    toast('Password changed.');
  } catch (err) {
    showErrors('passwordErrors', [`Could not change the password: ${err.message}`]);
  } finally {
    submit.disabled = false;
  }
}

function signOut(message) {
  saveSession(null);
  currentUser = null;
  if (adminPanel) adminPanel.hideNewLogin(); // never leave a shown password on screen
  cart.clear();
  hideErrors('cartErrors');
  prepareSignInForm();
  render();
  if (message) showErrors('signInErrors', [message]);
  focusSignIn();
}

function leaveShopForAdmin() {
  const name = currentUser.name;
  saveSession(null);
  currentUser = null;
  cart.clear();
  showBanner(`Signed out of the shop login "${name}" on this tab to open the admin sign-in.`, 'info');
}

// At /admin the Shop ID is filled in, so the admin only types the passcode.
function prepareSignInForm() {
  if (isAdminAddress() && !$('loginId').value.trim()) $('loginId').value = ADMIN_LOGIN_ID;
  updateSignInMode();
}

function focusSignIn() {
  if (isAdminAddress() && normalizeLoginId($('loginId').value) === ADMIN_LOGIN_ID) $('loginPassword').focus();
  else $('loginId').focus();
}

// Start each user on their own view: a manager sees their store, the buyer all stores.
function resetFilters() {
  filters.query = '';
  filters.status = 'all';
  filters.storeId = defaultStoreFor(currentUser);
  rowLimit = ROW_STEP;
}

function restoreUser() {
  try {
    session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    session = null;
  }
  currentUser = resolveUser();
  if (!currentUser) session = null;
  // /admin is the admin's door: a shop still signed in on this tab is signed
  // out first, so the admin portal never opens a shop's dashboard.
  if (currentUser && !isAdmin() && isAdminAddress()) leaveShopForAdmin();
  resetFilters();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function bindEvents() {
  $('signInForm').addEventListener('submit', onSignInSubmit);
  $('loginId').addEventListener('input', () => {
    updateSignInMode();
    if (!$('forgotPanel').classList.contains('d-none')) renderForgotPanel();
  });
  $('loginPassword').addEventListener('input', (e) => e.currentTarget.setCustomValidity(''));
  $('loginPasswordConfirm').addEventListener('input', (e) => e.currentTarget.setCustomValidity(''));
  $('forgotToggle').addEventListener('click', (e) => {
    const open = $('forgotPanel').classList.toggle('d-none') === false;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    if (open) {
      renderForgotPanel();
      const input = document.getElementById('forgotConfirm');
      if (input) input.focus();
    }
  });
  $('changePasswordBtn').addEventListener('click', openPasswordModal);
  $('tempPasswordBtn').addEventListener('click', openPasswordModal);
  $('passwordForm').addEventListener('submit', onPasswordSubmit);
  for (const id of ['newPassword', 'confirmPassword']) $(id).addEventListener('input', (e) => e.currentTarget.setCustomValidity(''));
  $('togglePassword').addEventListener('click', (e) => {
    const input = $('loginPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });
  $('signOutBtn').addEventListener('click', () => signOut());

  // One click: list only the items this shop has stopped selling (or go back).
  $('stoppedBtn').addEventListener('click', () => {
    filters.status = filters.status === 'Stopped' ? 'all' : 'Stopped';
    if (filters.status === 'Stopped') filters.storeId = currentUser.storeId;
    rowLimit = ROW_STEP;
    render();
  });

  // Filters (R9)
  $('filterForm').addEventListener('submit', (e) => e.preventDefault());
  // Search waits for a short pause in typing, so fast typing redraws once.
  $('searchInput').addEventListener('input', (e) => {
    filters.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      rowLimit = ROW_STEP;
      renderTable();
    }, 150);
  });
  // The store filter changes the cards and alerts too, so redraw everything.
  $('storeFilter').addEventListener('change', (e) => {
    filters.storeId = e.target.value;
    rowLimit = ROW_STEP;
    render();
  });
  $('statusFilter').addEventListener('change', (e) => {
    filters.status = e.target.value;
    rowLimit = ROW_STEP;
    render(); // also updates the Stopped selling button
  });
  $('clearFilters').addEventListener('click', () => {
    filters.query = '';
    filters.storeId = 'all';
    filters.status = 'all';
    rowLimit = ROW_STEP;
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
  $('printBtn').addEventListener('click', () => window.print());
  // Print every matching row, not just the batch on screen, then go back.
  window.addEventListener('beforeprint', () => {
    if (!currentUser || isAdmin()) return;
    renderPrintMeta();
    if (visibleRows.length > rowLimit) {
      rowLimit = Infinity;
      renderTable();
      window.addEventListener('afterprint', () => {
        rowLimit = ROW_STEP;
        renderTable();
      }, { once: true });
    }
  });

  // Row buttons
  $('stockBody').addEventListener('click', (e) => {
    if (e.target.closest('#showMoreRows')) {
      rowLimit += ROW_STEP;
      renderTable();
      if ($('showMoreRows')) $('showMoreRows').focus(); // keyboard users can keep pressing it
      return;
    }
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

  for (const id of ['receiveModal', 'transferModal', 'reorderModal', 'productModal', 'passwordModal']) bindModalFocus(id);
  $('receiveForm').addEventListener('submit', onReceiveSubmit);
  $('transferForm').addEventListener('submit', onTransferSubmit);
  $('reorderForm').addEventListener('submit', onReorderSubmit);
  $('productForm').addEventListener('submit', onProductSubmit);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
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

  try {
    $('cartHeading').setAttribute('tabindex', '-1');
    restoreUser();
    bindEvents();
    prepareSignInForm();
    window.addEventListener('hashchange', () => {
      if (currentUser && !isAdmin() && isAdminAddress()) {
        leaveShopForAdmin();
        render();
      }
      if (!currentUser) {
        prepareSignInForm();
        focusSignIn();
      }
    });

    // The admin passcode was changed or cleared in another tab: sign this admin tab out.
    window.addEventListener('storage', (event) => {
      if (event.key !== 'inventorysync:admin' && event.key !== null) return;
      if (isAdmin() && !isAdminSession(session && session.hash)) signOut('You were signed out: the admin password was changed.');
      else if (!currentUser) updateSignInMode();
    });

    // R4: when another tab saves, take its data and redraw (no save here, so no loop).
    store.subscribe((fresh) => {
      state = fresh;
      const wasSignedIn = Boolean(currentUser);
      currentUser = resolveUser();
      if (wasSignedIn && !currentUser) {
        signOut('You were signed out: this login was disabled or its password was changed.');
        return;
      }
      scheduleRender();
    });

    render();
    if (!currentUser && isAdminAddress()) focusSignIn(); // /admin: straight to the passcode box
    window.inventorySyncStarted = true; // read by the safety-net script in index.html
  } catch (err) {
    // Usually an old cached copy of the page mixed with newer code: say so instead of a blank page.
    showBanner(`InventorySync could not start (${err.message}). Reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac).`, 'danger');
    window.inventorySyncStarted = true; // the message above replaces the safety-net one
  }
}

start();
