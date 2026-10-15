// admin.js: the head-office admin page. Sign in with a passcode, add shops,
// create shop logins (Shop ID + password), reset or disable them, and see
// every shop at a glance.
//
// Like app.js, it changes data only through rules in inventory.js
// (createAccount, resetAccountPassword, setAccountDisabled, addStore), which
// check can() first.
//
// Limits of a browser-only demo (there is no server):
// - Data, shop logins and the passcode live in this browser's storage, so a
//   login works only in the browser where it was created.
// - Passwords and the passcode are stored as salted PBKDF2 hashes, never as
//   typed, but anyone with access to this browser's developer tools can
//   change stored data. Real accounts need the pilot's server-side sign-in (R11).

import {
  createAccount,
  resetAccountPassword,
  setAccountDisabled,
  disableAllAccounts,
  suggestLoginId,
  addStore,
  summarize,
  findStore,
} from './inventory.js';
import * as store from './store.js';
import { inr, $, h, showBanner, toast, showErrors, hideErrors, initTheme, formatTime } from './ui.js';
import { isCryptoAvailable, hashSecret, newSalt, toBase64, fromBase64, generatePassword, makePasswordRecord, PASSWORD_ITERATIONS } from './crypto.js';

const AUTH_KEY = 'inventorysync:admin'; // localStorage: { salt, hash, iterations }
const SESSION_KEY = 'inventorysync:adminSession'; // sessionStorage: signed in for this tab
const ADMIN = { id: 'admin', name: 'Admin', role: 'admin', storeId: null };

let state = null;
let signedIn = false;

// ---------------------------------------------------------------------------
// Admin passcode (PBKDF2 with a random salt)
// ---------------------------------------------------------------------------

function readAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY));
    return auth && auth.salt && auth.hash ? auth : null;
  } catch {
    return null;
  }
}

function readSession() {
  try {
    const auth = readAuth();
    return Boolean(auth) && sessionStorage.getItem(SESSION_KEY) === auth.hash;
  } catch {
    return false;
  }
}

function writeSession(auth) {
  try {
    if (auth) sessionStorage.setItem(SESSION_KEY, auth.hash);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // sessionStorage blocked: sign in again after a refresh
  }
}

// ---------------------------------------------------------------------------
// Writes: re-read, apply a rule, save once (same pattern as app.js)
// ---------------------------------------------------------------------------

function runAdminWrite(apply, { errorBox, success }) {
  const latest = store.readLatest();
  if (latest) state = latest;
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
  if (success) toast(success);
  return result;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function accountsOf() {
  return Array.isArray(state.accounts) ? state.accounts : [];
}

function storeLabel(account) {
  if (account.role === 'buyer') return 'Head office (all shops)';
  const s = findStore(state, account.storeId);
  return s ? s.name : 'Removed shop';
}

function render() {
  $('adminLogin').classList.toggle('d-none', signedIn);
  $('adminApp').classList.toggle('d-none', !signedIn);
  $('adminSignOut').classList.toggle('d-none', !signedIn);
  if (!signedIn) {
    renderLogin();
    return;
  }
  renderShops();
  renderAccountShopSelect();
  renderAccounts();
}

function renderLogin() {
  const setup = !readAuth();
  $('adminLoginHeading').textContent = setup ? 'Set up the admin passcode' : 'Admin sign in';
  $('adminLoginHelp').textContent = setup
    ? 'This is the first visit to the admin page in this browser. Choose a passcode of at least 8 characters and keep it safe.'
    : 'Enter the admin passcode.';
  $('confirmWrap').classList.toggle('d-none', !setup);
  $('forgotWrap').classList.toggle('d-none', setup);
  if (setup) {
    $('forgotPanel').classList.add('d-none');
    $('forgotToggle').setAttribute('aria-expanded', 'false');
  }
  $('adminPasscodeConfirm').required = setup;
  $('adminPasscode').autocomplete = setup ? 'new-password' : 'current-password';
  $('adminLoginSubmit').textContent = setup ? 'Save passcode and sign in' : 'Sign in';
}

function renderShops() {
  $('shopCount').textContent = String(state.stores.length);
  $('shopsBody').replaceChildren(...state.stores.map((s) => {
    const sum = summarize(state, s.id);
    const active = accountsOf().filter((a) => !a.disabled && a.storeId === s.id).length;
    return h('tr', {},
      h('td', { class: 'fw-semibold' }, s.name),
      h('td', {}, s.city || '—'),
      h('td', { class: 'text-end qty-cell' }, sum.low),
      h('td', { class: 'text-end qty-cell' }, sum.out),
      h('td', { class: 'text-end qty-cell' }, sum.stopped),
      h('td', { class: 'text-end qty-cell' }, inr.format(sum.stockValue)),
      h('td', { class: 'text-end qty-cell' }, active === 0 ? h('span', { class: 'text-danger' }, '0') : active));
  }));
}

function renderAccountShopSelect() {
  const select = $('accountShop');
  const current = select.value;
  select.replaceChildren(
    h('option', { value: '' }, 'Choose a shop…'),
    ...state.stores.map((s) => h('option', { value: s.id }, s.name)),
    h('option', { value: 'all' }, 'Head office (all shops, can transfer and set reorder levels)'));
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function renderAccounts() {
  const accounts = [...accountsOf()];
  // Active logins first, newest first.
  accounts.sort((a, b) => (a.disabled - b.disabled) || String(b.createdAt).localeCompare(String(a.createdAt)));
  $('loginCount').textContent = String(accounts.filter((a) => !a.disabled).length);
  if (accounts.length === 0) {
    $('loginsBody').replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'text-center text-body-secondary py-4' },
      'No shop logins yet. Create one for each shop above.')));
    return;
  }
  $('loginsBody').replaceChildren(...accounts.map((a) => h('tr', { class: a.disabled ? 'row-stopped' : null },
    h('td', {}, h('code', { class: 'login-id' }, a.loginId)),
    h('td', {}, storeLabel(a)),
    h('td', { class: 'product-name' }, a.label),
    h('td', { class: 'text-nowrap small' }, formatTime(a.createdAt)),
    h('td', { class: 'text-nowrap small' }, a.lastUsedAt ? formatTime(a.lastUsedAt) : 'Never'),
    h('td', { class: 'text-center' }, h('span', { class: `badge status-badge ${a.disabled ? 'text-bg-secondary' : 'text-bg-success'}` }, a.disabled ? 'Disabled' : 'Active')),
    h('td', { class: 'text-end' }, h('div', { class: 'btn-group btn-group-sm row-actions', role: 'group', 'aria-label': `Actions for ${a.loginId}` },
      h('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-reset': a.loginId, 'aria-label': `Reset password for ${a.loginId}` }, 'Reset password'),
      a.disabled
        ? h('button', { type: 'button', class: 'btn btn-outline-success', 'data-enable': a.loginId, 'aria-label': `Enable ${a.loginId}` }, 'Enable')
        : h('button', { type: 'button', class: 'btn btn-outline-danger', 'data-disable': a.loginId, 'aria-label': `Disable ${a.loginId}` }, 'Disable'))))));
}

// Show a Shop ID and its new password once, with Copy buttons.
function showNewLogin(title, loginId, password) {
  $('newLoginTitle').textContent = title;
  $('newLoginId').textContent = loginId;
  $('newLoginPassword').textContent = password;
  $('copyLoginId').dataset.copy = loginId;
  $('copyLoginPassword').dataset.copy = password;
  $('newLoginBox').classList.remove('d-none');
  $('copyLoginId').focus();
}

function hideNewLogin() {
  $('newLoginBox').classList.add('d-none');
  $('newLoginPassword').textContent = '';
  $('copyLoginPassword').dataset.copy = '';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function onLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  const setup = !readAuth();
  const passcode = $('adminPasscode').value;
  const confirmInput = $('adminPasscodeConfirm');
  confirmInput.setCustomValidity(setup && confirmInput.value !== passcode ? 'Passcodes do not match.' : '');
  if (!form.checkValidity()) return;

  try {
    if (setup) {
      const salt = newSalt();
      const auth = { salt: toBase64(salt), hash: await hashSecret(passcode, salt, PASSWORD_ITERATIONS), iterations: PASSWORD_ITERATIONS };
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      writeSession(auth);
    } else {
      const auth = readAuth();
      const hash = await hashSecret(passcode, fromBase64(auth.salt), auth.iterations || PASSWORD_ITERATIONS);
      if (hash !== auth.hash) {
        showErrors('adminLoginErrors', ['That passcode is not right.']);
        $('adminPasscode').select();
        return;
      }
      writeSession(auth);
    }
  } catch (err) {
    showErrors('adminLoginErrors', [`Could not sign in: ${err.message}`]);
    return;
  }
  form.reset();
  form.classList.remove('was-validated');
  hideErrors('adminLoginErrors');
  signedIn = true;
  render();
}

// Forgotten passcode: disable every shop login, forget the passcode, and go
// back to "Set up the admin passcode".
function onForgotSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  if ($('forgotConfirm').value.trim() !== 'RESET') {
    $('forgotConfirm').setCustomValidity('Type RESET to confirm.');
    return;
  }
  const latest = store.readLatest();
  if (latest) state = latest;
  const result = disableAllAccounts(state);
  const saved = store.save(result.state);
  if (!saved.ok) {
    showErrors('forgotErrors', [saved.error]);
    return;
  }
  state = result.state;
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // nothing stored
  }
  writeSession(null);
  form.reset();
  form.classList.remove('was-validated');
  hideErrors('forgotErrors');
  hideErrors('adminLoginErrors');
  signedIn = false;
  render();
  showBanner(`Passcode cleared and ${result.disabled} shop login${result.disabled === 1 ? '' : 's'} disabled. Set a new passcode, then enable each login again or reset its password.`, 'info');
  $('adminPasscode').focus();
}

function signOut() {
  writeSession(null);
  signedIn = false;
  hideNewLogin();
  render();
  $('adminPasscode').focus();
}

function onAddShop(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;
  const input = { name: $('shopName').value, city: $('shopCity').value };
  const done = runAdminWrite((s) => addStore(s, ADMIN, input), {
    errorBox: 'addShopErrors',
    success: `Added shop ${input.name.trim()}. Create a login for it.`,
  });
  if (done) {
    form.reset();
    form.classList.remove('was-validated');
    $('accountShop').value = done.storeId;
    fillDefaultLabel();
    $('accountLabel').focus();
  }
}

// Suggest a name for the login from the chosen shop, unless one was typed.
function fillDefaultLabel() {
  const input = $('accountLabel');
  if (input.value.trim() && !input.dataset.auto) return;
  const storeId = $('accountShop').value;
  const s = findStore(state, storeId);
  input.value = storeId === 'all' ? 'Head office' : (s ? `${s.name} shop` : '');
  input.dataset.auto = '1';
}

async function onCreateAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;
  const storeId = $('accountShop').value;
  const label = $('accountLabel').value;
  const submit = $('accountSubmit');
  submit.disabled = true;
  try {
    const password = generatePassword();
    const record = await makePasswordRecord(password); // hashing takes a moment
    const latest = store.readLatest();
    if (latest) state = latest;
    const loginId = suggestLoginId(state, storeId);
    const done = runAdminWrite((s) => createAccount(s, ADMIN, { loginId, storeId, label, password: record, now: new Date().toISOString() }), {
      errorBox: 'accountErrors',
      success: `Shop login ${loginId} created.`,
    });
    if (!done) return;
    form.reset();
    form.classList.remove('was-validated');
    delete $('accountLabel').dataset.auto;
    showNewLogin(`New login for ${storeId === 'all' ? 'Head office (all shops)' : findStore(state, storeId).name}:`, loginId, password);
  } catch (err) {
    showErrors('accountErrors', [`Could not create the login: ${err.message}`]);
  } finally {
    submit.disabled = false;
  }
}

async function onResetPassword(loginId) {
  if (!window.confirm(`Make a new password for ${loginId}? The old password stops working and the shop is signed out.`)) return;
  try {
    const password = generatePassword();
    const record = await makePasswordRecord(password);
    const done = runAdminWrite((s) => resetAccountPassword(s, ADMIN, loginId, record), {
      errorBox: 'accountErrors',
      success: `New password made for ${loginId}.`,
    });
    if (done) showNewLogin(`New password for ${loginId}:`, loginId, password);
  } catch (err) {
    showErrors('accountErrors', [`Could not reset the password: ${err.message}`]);
  }
}

function onSetDisabled(loginId, disabled) {
  if (disabled && !window.confirm(`Disable ${loginId}? The shop is signed out straight away and cannot sign in until you enable it again.`)) return;
  runAdminWrite((s) => setAccountDisabled(s, ADMIN, loginId, disabled), {
    errorBox: 'accountErrors',
    success: disabled ? `${loginId} disabled.` : `${loginId} enabled.`,
  });
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied the ${what}.`);
  } catch {
    toast(`Copy did not work here. Select the ${what} and copy it by hand.`, 'danger');
  }
}

async function onReset() {
  if (!window.confirm('Reset all data to the sample? Every shop you added and every shop login will be deleted, and shops will be signed out.')) return;
  try {
    const { state: fresh, notice } = await store.reset();
    state = fresh;
    hideNewLogin();
    render();
    if (notice) showBanner(notice);
    else toast('Sample data restored.');
  } catch (err) {
    toast(`Reset failed: ${err.message}`, 'danger');
  }
}

function bindEvents() {
  $('adminLoginForm').addEventListener('submit', onLoginSubmit);
  $('adminPasscodeConfirm').addEventListener('input', (e) => e.currentTarget.setCustomValidity(''));
  $('forgotToggle').addEventListener('click', (e) => {
    const open = $('forgotPanel').classList.toggle('d-none') === false;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    if (open) $('forgotConfirm').focus();
  });
  $('forgotConfirm').addEventListener('input', (e) => e.currentTarget.setCustomValidity(''));
  $('forgotForm').addEventListener('submit', onForgotSubmit);
  $('adminSignOut').addEventListener('click', signOut);
  $('addShopForm').addEventListener('submit', onAddShop);
  $('accountShop').addEventListener('change', fillDefaultLabel);
  $('accountLabel').addEventListener('input', (e) => delete e.currentTarget.dataset.auto);
  $('accountForm').addEventListener('submit', onCreateAccount);
  $('copyLoginId').addEventListener('click', (e) => copyText(e.currentTarget.dataset.copy, 'Shop ID'));
  $('copyLoginPassword').addEventListener('click', (e) => copyText(e.currentTarget.dataset.copy, 'password'));
  $('loginsBody').addEventListener('click', (e) => {
    const reset = e.target.closest('[data-reset]');
    if (reset) onResetPassword(reset.dataset.reset);
    const disable = e.target.closest('[data-disable]');
    if (disable) onSetDisabled(disable.dataset.disable, true);
    const enable = e.target.closest('[data-enable]');
    if (enable) onSetDisabled(enable.dataset.enable, false);
  });
  $('resetBtn').addEventListener('click', onReset);
}

async function start() {
  window.inventorySyncAdminStarted = true; // read by the safety-net script in admin.html
  initTheme();
  if (!isCryptoAvailable()) {
    showBanner('This browser cannot run the admin page securely here. Open it over https or from localhost.', 'danger');
    return;
  }
  try {
    const { state: loaded, notice } = await store.load();
    state = loaded;
    if (notice) showBanner(notice);
  } catch (err) {
    showBanner(`Could not load data: ${err.message}.`, 'danger');
    return;
  }
  signedIn = readSession();
  bindEvents();
  // Shops signing in or selling in other tabs update the overview here.
  store.subscribe((fresh) => {
    state = fresh;
    render();
  });
  render();
}

start();
