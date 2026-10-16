// admin-panel.js: the "Shops & logins" view for the head-office admin. It is
// loaded by app.js only after the admin signs in, so shops never download or
// see it. Changes go through rules in inventory.js (createAccount,
// resetAccountPassword, setAccountDisabled, addStore), which check can() first.

import {
  createAccount,
  resetAccountPassword,
  setAccountDisabled,
  suggestLoginId,
  addStore,
  summarize,
  findStore,
} from './inventory.js';
import { inr, $, h, toast, showErrors, formatTime } from './ui.js';
import { generatePassword, makePasswordRecord } from './crypto.js';

// ctx: { container, getState, getUser, write(apply, { errorBox, success }) -> result | null, resetData() }
export function createAdminPanel(ctx) {
  const { container } = ctx;
  container.replaceChildren(buildSkeleton());
  bind();

  function accountsOf() {
    const state = ctx.getState();
    return Array.isArray(state.accounts) ? state.accounts : [];
  }

  function storeLabel(account) {
    if (account.role === 'buyer') return 'Head office (all shops)';
    const s = findStore(ctx.getState(), account.storeId);
    return s ? s.name : 'Removed shop';
  }

  // -------------------------------------------------------------------------
  // Layout (built once)
  // -------------------------------------------------------------------------

  function buildSkeleton() {
    const field = (id, label, input, feedback, help) => h('div', { class: 'mb-3' },
      h('label', { for: id, class: 'form-label' }, label), input,
      feedback ? h('div', { class: 'invalid-feedback' }, feedback) : null,
      help ? h('div', { class: 'form-text' }, help) : null);

    const shopsCard = h('section', { class: 'card h-100', 'aria-labelledby': 'shopsHeading' },
      h('div', { class: 'card-header d-flex align-items-center justify-content-between' },
        h('h2', { id: 'shopsHeading', class: 'h5 mb-0' }, 'Shops'),
        h('span', { id: 'shopCount', class: 'badge text-bg-secondary' }, '0')),
      h('div', { class: 'card-body' },
        h('div', { class: 'table-responsive' },
          h('table', { class: 'table table-sm align-middle mb-0' },
            h('caption', { class: 'visually-hidden' }, 'Every shop with its stock alerts and shop logins'),
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Shop'),
              h('th', { scope: 'col' }, 'City'),
              h('th', { scope: 'col', class: 'text-end' }, 'Low'),
              h('th', { scope: 'col', class: 'text-end' }, 'Out'),
              h('th', { scope: 'col', class: 'text-end' }, 'Stopped', h('br'), 'selling'),
              h('th', { scope: 'col', class: 'text-end' }, 'Stock value'),
              h('th', { scope: 'col', class: 'text-end' }, 'Active', h('br'), 'logins'))),
            h('tbody', { id: 'shopsBody' })))),
      h('div', { class: 'card-footer' },
        h('form', { id: 'addShopForm', class: 'row g-2 align-items-end', novalidate: true },
          h('div', { class: 'col-12' }, h('div', { id: 'addShopErrors', class: 'alert alert-danger d-none mb-2', role: 'alert' })),
          h('div', { class: 'col-12 col-sm-5' },
            h('label', { for: 'shopName', class: 'form-label small mb-1' }, 'New shop name'),
            h('input', { id: 'shopName', type: 'text', class: 'form-control', required: true, minlength: '2', maxlength: '40', autocomplete: 'off' }),
            h('div', { class: 'invalid-feedback' }, '2–40 characters.')),
          h('div', { class: 'col-12 col-sm-4' },
            h('label', { for: 'shopCity', class: 'form-label small mb-1' }, 'City'),
            h('input', { id: 'shopCity', type: 'text', class: 'form-control', maxlength: '40', autocomplete: 'off' })),
          h('div', { class: 'col-12 col-sm-3' },
            h('button', { type: 'submit', class: 'btn btn-outline-primary w-100' }, 'Add shop')))));

    const createCard = h('section', { class: 'card h-100', 'aria-labelledby': 'loginHeading' },
      h('div', { class: 'card-header' }, h('h2', { id: 'loginHeading', class: 'h5 mb-0' }, 'Create shop login')),
      h('div', { class: 'card-body' },
        h('form', { id: 'accountForm', novalidate: true },
          h('div', { id: 'accountErrors', class: 'alert alert-danger d-none', role: 'alert' }),
          field('accountShop', 'For', h('select', { id: 'accountShop', class: 'form-select', required: true }), 'Choose a shop.'),
          field('accountLabel', 'Name for this login',
            h('input', { id: 'accountLabel', type: 'text', class: 'form-control', required: true, minlength: '2', maxlength: '60', placeholder: 'e.g. Indiranagar counter', autocomplete: 'off' }),
            '2–60 characters.', 'Shown to the shop after it signs in.'),
          h('button', { id: 'accountSubmit', type: 'submit', class: 'btn btn-primary w-100' }, 'Generate Shop ID and password')),
        h('div', { id: 'newLoginBox', class: 'new-code-box d-none mt-3', role: 'status', 'aria-live': 'polite' },
          h('p', { id: 'newLoginTitle', class: 'small text-body-secondary mb-2' }),
          h('dl', { class: 'login-pair mb-2' },
            h('dt', {}, 'Shop ID'),
            h('dd', {}, h('code', { id: 'newLoginId', class: 'new-code' }),
              h('button', { id: 'copyLoginId', type: 'button', class: 'btn btn-sm btn-outline-secondary' }, 'Copy')),
            h('dt', {}, 'Password'),
            h('dd', {}, h('code', { id: 'newLoginPassword', class: 'new-code' }),
              h('button', { id: 'copyLoginPassword', type: 'button', class: 'btn btn-sm btn-outline-secondary' }, 'Copy'))),
          h('p', { class: 'small text-body-secondary mb-0' },
            'The password is shown ', h('strong', {}, 'only this once'), '; it is not stored. Give both to the shop. ',
            'The shop is asked to change it to one only it knows. If it is lost, use ', h('em', {}, 'Reset password'), '.'))));

    const loginsCard = h('section', { class: 'card', 'aria-labelledby': 'loginsHeading' },
      h('div', { class: 'card-header d-flex align-items-center justify-content-between' },
        h('h2', { id: 'loginsHeading', class: 'h5 mb-0' }, 'Shop logins'),
        h('span', { id: 'loginCount', class: 'badge text-bg-secondary' }, '0')),
      h('div', { class: 'card-body' },
        h('div', { class: 'table-responsive' },
          h('table', { class: 'table table-sm align-middle mb-0' },
            h('caption', { class: 'visually-hidden' }, 'Every shop login, who it is for and whether it is active'),
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Shop ID'),
              h('th', { scope: 'col' }, 'For'),
              h('th', { scope: 'col' }, 'Name'),
              h('th', { scope: 'col' }, 'Created'),
              h('th', { scope: 'col' }, 'Last sign-in'),
              h('th', { scope: 'col' }, 'Password'),
              h('th', { scope: 'col', class: 'text-center' }, 'Status'),
              h('th', { scope: 'col', class: 'text-end' }, 'Actions'))),
            h('tbody', { id: 'loginsBody' })))));

    const resetCard = h('section', { class: 'card border-danger-subtle', 'aria-labelledby': 'resetHeading' },
      h('div', { class: 'card-body d-flex flex-wrap gap-3 align-items-center justify-content-between' },
        h('div', {},
          h('h2', { id: 'resetHeading', class: 'h6 mb-1' }, 'Reset demo data'),
          h('p', { class: 'small text-body-secondary mb-0' }, 'Restores the sample stock and deletes every shop you added and every shop login. Shops are signed out.')),
        h('button', { id: 'resetBtn', type: 'button', class: 'btn btn-outline-danger' }, 'Reset data')));

    return h('div', { class: 'row g-3' },
      h('h1', { class: 'visually-hidden' }, 'Shops and logins'),
      h('div', { class: 'col-12 col-lg-8' }, shopsCard),
      h('div', { class: 'col-12 col-lg-4' }, createCard),
      h('div', { class: 'col-12' }, loginsCard),
      h('div', { class: 'col-12' }, resetCard));
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function render() {
    renderShops();
    renderAccountShopSelect();
    renderAccounts();
  }

  function renderShops() {
    const state = ctx.getState();
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
    const state = ctx.getState();
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
      $('loginsBody').replaceChildren(h('tr', {}, h('td', { colspan: '8', class: 'text-center text-body-secondary py-4' },
        'No shop logins yet. Create one for each shop above.')));
      return;
    }
    $('loginsBody').replaceChildren(...accounts.map((a) => h('tr', { class: a.disabled ? 'row-stopped' : null },
      h('td', {}, h('code', { class: 'login-id' }, a.loginId)),
      h('td', {}, storeLabel(a)),
      h('td', { class: 'product-name' }, a.label),
      h('td', { class: 'text-nowrap small' }, formatTime(a.createdAt)),
      h('td', { class: 'text-nowrap small' }, a.lastUsedAt ? formatTime(a.lastUsedAt) : 'Never'),
      h('td', { class: 'small' }, a.tempPassword ? h('span', { class: 'text-warning-emphasis' }, 'From head office') : 'Changed by shop'),
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

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function onAddShop(event) {
    event.preventDefault();
    const form = event.currentTarget;
    form.classList.add('was-validated');
    if (!form.checkValidity()) return;
    const input = { name: $('shopName').value, city: $('shopCity').value };
    const done = ctx.write((s) => addStore(s, ctx.getUser(), input), {
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
    const s = findStore(ctx.getState(), storeId);
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
      let loginId = null;
      const done = ctx.write((s) => {
        loginId = suggestLoginId(s, storeId);
        return createAccount(s, ctx.getUser(), { loginId, storeId, label, password: record, now: new Date().toISOString() });
      }, { errorBox: 'accountErrors', success: null });
      if (!done) return;
      toast(`Shop login ${loginId} created.`);
      form.reset();
      form.classList.remove('was-validated');
      delete $('accountLabel').dataset.auto;
      const forName = storeId === 'all' ? 'Head office (all shops)' : findStore(ctx.getState(), storeId).name;
      showNewLogin(`New login for ${forName}:`, loginId, password);
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
      const done = ctx.write((s) => resetAccountPassword(s, ctx.getUser(), loginId, record), {
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
    ctx.write((s) => setAccountDisabled(s, ctx.getUser(), loginId, disabled), {
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
    hideNewLogin();
    await ctx.resetData();
  }

  function bind() {
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

  return { render, hideNewLogin };
}
