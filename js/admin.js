// admin.js: the head-office admin page. Sign in with a passcode, add shops,
// create and revoke invite codes, and see every shop at a glance.
//
// Like app.js, it changes data only through rules in inventory.js
// (createInvite, revokeInvite, addStore), which check can() first.
//
// Limits of a browser-only demo (there is no server):
// - Data, invite codes and the passcode live in this browser's storage, so a
//   code works only in the browser where it was created.
// - The passcode is stored as a salted PBKDF2 hash, never as typed, but
//   anyone with access to this browser's developer tools can change stored
//   data. Real accounts need the pilot's server-side sign-in (R11).

import { createInvite, revokeInvite, revokeAllInvites, addStore, summarize, findStore, findInvite } from './inventory.js';
import * as store from './store.js';
import { inr, $, h, showBanner, toast, showErrors, hideErrors, initTheme, formatTime } from './ui.js';

const AUTH_KEY = 'inventorysync:admin'; // localStorage: { salt, hash, iterations }
const SESSION_KEY = 'inventorysync:adminSession'; // sessionStorage: signed in for this tab
const ADMIN = { id: 'admin', name: 'Admin', role: 'admin', storeId: null };
const ITERATIONS = 150000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread

let state = null;
let signedIn = false;

// ---------------------------------------------------------------------------
// Passcode (PBKDF2 with a random salt, via the browser's Web Crypto API)
// ---------------------------------------------------------------------------

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function hashPasscode(passcode, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toBase64(new Uint8Array(bits));
}

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
// Invite codes: 12 random characters, shown as ABCD-EFGH-JKLM
// ---------------------------------------------------------------------------

function newInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  // 256 is a multiple of 32, so "byte % 32" picks every letter equally often.
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
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

function storeLabel(invite) {
  if (invite.role === 'buyer') return 'Head office (all shops)';
  const s = findStore(state, invite.storeId);
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
  renderInviteShopSelect();
  renderCodes();
}

function renderLogin() {
  const setup = !readAuth();
  $('adminLoginHeading').textContent = setup ? 'Set up the admin passcode' : 'Admin sign in';
  $('adminLoginHelp').textContent = setup
    ? 'This is the first visit to the admin page in this browser. Choose a passcode of at least 8 characters and keep it safe: it cannot be recovered.'
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
  const invites = Array.isArray(state.invites) ? state.invites : [];
  $('shopCount').textContent = String(state.stores.length);
  $('shopsBody').replaceChildren(...state.stores.map((s) => {
    const sum = summarize(state, s.id);
    const activeCodes = invites.filter((i) => !i.revoked && i.storeId === s.id).length;
    return h('tr', {},
      h('td', { class: 'fw-semibold' }, s.name),
      h('td', {}, s.city || '—'),
      h('td', { class: 'text-end qty-cell' }, sum.low),
      h('td', { class: 'text-end qty-cell' }, sum.out),
      h('td', { class: 'text-end qty-cell' }, sum.stopped),
      h('td', { class: 'text-end qty-cell' }, inr.format(sum.stockValue)),
      h('td', { class: 'text-end qty-cell' }, activeCodes === 0
        ? h('span', { class: 'text-danger' }, '0')
        : activeCodes));
  }));
}

function renderInviteShopSelect() {
  const select = $('inviteShop');
  const current = select.value;
  select.replaceChildren(
    h('option', { value: '' }, 'Choose a shop…'),
    ...state.stores.map((s) => h('option', { value: s.id }, s.name)),
    h('option', { value: 'all' }, 'Head office (all shops, can transfer and set reorder levels)'));
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function renderCodes() {
  const invites = Array.isArray(state.invites) ? [...state.invites] : [];
  // Active codes first, newest first.
  invites.sort((a, b) => (a.revoked - b.revoked) || String(b.createdAt).localeCompare(String(a.createdAt)));
  $('codeCount').textContent = String(invites.filter((i) => !i.revoked).length);
  if (invites.length === 0) {
    $('codesBody').replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'text-center text-body-secondary py-4' },
      'No invite codes yet. Create one for each shop above.')));
    return;
  }
  $('codesBody').replaceChildren(...invites.map((i) => h('tr', { class: i.revoked ? 'row-stopped' : null },
    h('td', {}, h('code', { class: 'invite-code' }, i.code)),
    h('td', {}, storeLabel(i)),
    h('td', { class: 'product-name' }, i.label),
    h('td', { class: 'text-nowrap small' }, formatTime(i.createdAt)),
    h('td', { class: 'text-nowrap small' }, i.lastUsedAt ? formatTime(i.lastUsedAt) : 'Never'),
    h('td', { class: 'text-center' }, h('span', { class: `badge status-badge ${i.revoked ? 'text-bg-secondary' : 'text-bg-success'}` }, i.revoked ? 'Revoked' : 'Active')),
    h('td', { class: 'text-end' }, i.revoked ? null : h('div', { class: 'btn-group btn-group-sm row-actions', role: 'group', 'aria-label': `Actions for code ${i.code}` },
      h('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-copy': i.code, 'aria-label': `Copy code ${i.code}` }, 'Copy'),
      h('button', { type: 'button', class: 'btn btn-outline-danger', 'data-revoke': i.code, 'aria-label': `Revoke code ${i.code}` }, 'Revoke'))))));
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
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const auth = { salt: toBase64(salt), hash: await hashPasscode(passcode, salt, ITERATIONS), iterations: ITERATIONS };
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      writeSession(auth);
    } else {
      const auth = readAuth();
      const hash = await hashPasscode(passcode, fromBase64(auth.salt), auth.iterations || ITERATIONS);
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

// Forgotten passcode: revoke every invite code, forget the passcode, and go
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
  const result = revokeAllInvites(state);
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
  showBanner(`Passcode cleared and ${result.revoked} invite code${result.revoked === 1 ? '' : 's'} revoked. Set a new passcode, then create new codes for each shop.`, 'info');
  $('adminPasscode').focus();
}

function signOut() {
  writeSession(null);
  signedIn = false;
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
    success: `Added shop ${input.name.trim()}. Create an invite code for it.`,
  });
  if (done) {
    form.reset();
    form.classList.remove('was-validated');
    $('inviteShop').value = done.storeId;
    $('inviteLabel').focus();
  }
}

function onCreateInvite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.classList.add('was-validated');
  if (!form.checkValidity()) return;
  const storeId = $('inviteShop').value;
  const label = $('inviteLabel').value;
  // A clash with an existing code is very unlikely; if it happens, draw again.
  let code = newInviteCode();
  while (findInvite(store.readLatest() || state, code)) code = newInviteCode();
  const done = runAdminWrite((s) => createInvite(s, ADMIN, { code, storeId, label, now: new Date().toISOString() }), {
    errorBox: 'inviteErrors',
    success: `Invite code ${code} created.`,
  });
  if (!done) return;
  $('newCode').textContent = code;
  $('newCodeFor').textContent = storeLabel(done.state.invites.find((i) => i.code === code));
  $('newCodeBox').classList.remove('d-none');
  $('copyNewCode').dataset.copy = code;
  form.reset();
  form.classList.remove('was-validated');
  $('copyNewCode').focus();
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast(`Copied ${code}.`);
  } catch {
    toast(`Copy did not work here. Select the code and copy it: ${code}`, 'danger');
  }
}

function onRevoke(code) {
  if (!window.confirm(`Revoke invite code ${code}? A shop signed in with it is signed out straight away.`)) return;
  runAdminWrite((s) => revokeInvite(s, ADMIN, code), { errorBox: 'inviteErrors', success: `Code ${code} revoked.` });
}

async function onReset() {
  if (!window.confirm('Reset all data to the sample? Every shop you added and every invite code will be deleted, and shops will be signed out.')) return;
  try {
    const { state: fresh, notice } = await store.reset();
    state = fresh;
    $('newCodeBox').classList.add('d-none');
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
  $('inviteForm').addEventListener('submit', onCreateInvite);
  $('copyNewCode').addEventListener('click', (e) => copyCode(e.currentTarget.dataset.copy));
  $('codesBody').addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) copyCode(copy.dataset.copy);
    const revoke = e.target.closest('[data-revoke]');
    if (revoke) onRevoke(revoke.dataset.revoke);
  });
  $('resetBtn').addEventListener('click', onReset);
}

async function start() {
  window.inventorySyncAdminStarted = true; // read by the safety-net script in admin.html
  initTheme();
  if (!window.crypto || !crypto.subtle) {
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
