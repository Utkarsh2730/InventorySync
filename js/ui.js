// ui.js: small page helpers shared by the shop page (app.js) and the admin
// page (admin.js). Building elements, messages and dark mode.

const THEME_KEY = 'inventorysync:theme'; // localStorage: dark/light choice

export const bs = window.bootstrap || null; // Bootstrap's JS bundle (from vendor/)

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
// Tax amounts always show paise: ₹8.10, not ₹8.1.
export const inrTax = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const $ = (id) => document.getElementById(id);

// Build an element safely. Text always goes in via textContent, never as HTML,
// so names typed by users cannot inject markup.
export function h(tag, attrs = {}, ...children) {
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

export function showBanner(message, type = 'warning') {
  const alert = h('div', { class: `alert alert-${type} alert-dismissible`, role: 'alert' },
    message,
    h('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'alert', 'aria-label': 'Close' }));
  $('banner').append(alert);
}

export function toast(message, type = 'success') {
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

// A refused action lists its reasons inside the given box.
export function showErrors(boxId, errors) {
  const box = $(boxId);
  box.replaceChildren(
    h('p', { class: 'fw-semibold mb-1' }, 'Refused. Nothing was changed:'),
    h('ul', { class: 'mb-0' }, errors.map((e) => h('li', {}, e))));
  box.classList.remove('d-none');
}

export function hideErrors(boxId) {
  const box = $(boxId);
  box.replaceChildren();
  box.classList.add('d-none');
}

// Dark mode toggle: the button names the mode it switches to. A saved choice
// wins; without one the page follows the OS setting.
export function initTheme(buttonId = 'themeToggle') {
  const btn = $(buttonId);
  const root = document.documentElement;
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

// Format an ISO time for tables, e.g. "16 Oct 2026, 2:05 pm".
export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
