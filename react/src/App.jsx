// InventorySync, React version. Same rules file (js/inventory.js), same
// storage and sync (js/store.js), same CSV export (js/export.js) as the
// vanilla build; only the drawing code is new.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  isPositiveInt,
} from '../../js/inventory.js';
import { downloadRowsAsCsv } from '../../js/export.js';
import { useInventory } from './useInventory.js';
import { storeNameOf, userLabel } from './format.js';
import { SignIn, SummaryCards, Filters, StockTable, AlertPanel } from './components/Dashboard.jsx';
import { Cart, cartCount } from './components/Cart.jsx';
import { ReceiveDialog, TransferDialog, ReorderDialog, ProductDialog } from './components/Dialogs.jsx';

const USER_KEY = 'inventorysync:userId'; // sessionStorage: one user per tab
const THEME_KEY = 'inventorysync:theme';

function readSessionUser() {
  try {
    return sessionStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-bs-theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
  }, [theme]);
  useEffect(() => {
    // Follow OS changes only while the user has not picked a theme.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      let saved = null;
      try {
        saved = localStorage.getItem(THEME_KEY);
      } catch {
        saved = null;
      }
      if (!saved) setTheme(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // not remembered, but still switches
    }
    setTheme(next);
  };
  return [theme, toggle];
}

let toastId = 0;

export default function App() {
  const { state, notice, loadError, latest, write, reset } = useInventory();
  const [theme, toggleTheme] = useTheme();
  const [userId, setUserId] = useState(readSessionUser);
  const [filters, setFilters] = useState({ query: '', storeId: 'all', status: 'all' });
  const [cart, setCart] = useState({}); // sku -> qty, in memory for this tab
  const [cartErrors, setCartErrors] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { type, storeId, sku }
  const [toasts, setToasts] = useState([]);
  const [banners, setBanners] = useState([]);

  const user = state ? state.users.find((u) => u.id === userId) || null : null;
  const storeName = useCallback((id) => storeNameOf(state, id), [state]);

  useEffect(() => {
    if (notice) setBanners((b) => [...b, notice]);
  }, [notice]);

  const toast = useCallback((message, type = 'success') => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'danger' ? 6000 : 3500);
  }, []);

  const allRows = useMemo(() => (state ? buildRows(state) : []), [state]);
  const visibleRows = useMemo(() => filterRows(allRows, filters), [allRows, filters]);
  const summary = useMemo(() => (state ? summarize(state) : null), [state]);
  const alerts = useMemo(() => (state ? alertsOf(state) : []), [state]);

  // Drop cart lines for products that no longer exist (e.g. after a reset elsewhere).
  useEffect(() => {
    if (!state) return;
    setCart((c) => {
      const kept = Object.fromEntries(Object.entries(c).filter(([sku]) => findProduct(state, sku)));
      return Object.keys(kept).length === Object.keys(c).length ? c : kept;
    });
  }, [state]);

  if (loadError) {
    return (
      <main className="container-fluid py-3">
        <div className="alert alert-danger" role="alert">Could not load data: {loadError}</div>
      </main>
    );
  }
  if (!state) return <main className="container-fluid py-3"><p>Loading…</p></main>;

  const signIn = (id) => {
    try {
      if (id) sessionStorage.setItem(USER_KEY, id);
      else sessionStorage.removeItem(USER_KEY);
    } catch {
      // sessionStorage blocked: pick again after a refresh
    }
    setUserId(id);
    setCart({});
    setCartErrors([]);
    setNavOpen(false);
  };

  const canSell = user ? can(user, 'sell', user.storeId) : false;

  // ---- writes: each goes through a rule in inventory.js via write() ----

  const runWrite = (apply, success) => {
    const result = write(apply);
    if (result.ok) toast(success);
    return result;
  };

  const addToCart = (storeId, sku) => {
    const fresh = latest();
    if (!can(user, 'sell', storeId)) {
      toast(`${user.name} is not allowed to ${ACTION_LABELS.sell} at ${storeName(storeId)}.`, 'danger');
      return;
    }
    const inStock = fresh.stock[storeId][sku].qty;
    const wanted = (isPositiveInt(cart[sku]) ? cart[sku] : 0) + 1;
    const name = findProduct(fresh, sku).name;
    if (wanted > inStock) {
      toast(`Only ${inStock} of ${name} in stock.`, 'danger');
      return;
    }
    setCart({ ...cart, [sku]: wanted });
    setCartErrors([]);
    toast(`Added ${name} (cart has ${wanted}).`);
  };

  const onCheckout = () => {
    const storeId = user.storeId;
    const lines = Object.entries(cart).map(([sku, qty]) => ({ sku, qty }));
    // All lines are checked against the freshly re-read stock; all or nothing; one save.
    const result = runWrite((s) => checkout(s, user, storeId, lines), `Sale recorded at ${storeName(storeId)}.`);
    if (result.ok) {
      setCart({});
      setCartErrors([]);
      setCartOpen(false);
    } else {
      setCartErrors(result.errors);
    }
  };

  const onAction = (action, storeId, sku) => {
    if (action === 'sell') addToCart(storeId, sku);
    else setDialog({ type: action, storeId, sku });
  };

  const closeDialog = () => setDialog(null);
  const finish = (result) => {
    if (result.ok) closeDialog();
    return result;
  };

  const onReset = async () => {
    if (!window.confirm('Reset all data to the sample? Every change in this browser will be lost.')) return;
    try {
      const result = await reset();
      setCart({});
      setCartErrors([]);
      if (result.notice) setBanners((b) => [...b, result.notice]);
      else toast('Sample data restored.');
    } catch (err) {
      toast(`Reset failed: ${err.message}`, 'danger');
    }
  };

  const onExport = () => {
    if (visibleRows.length === 0) {
      toast('No rows to export with these filters.', 'danger');
      return;
    }
    downloadRowsAsCsv(visibleRows);
    toast(`Exported ${visibleRows.length} rows to CSV.`);
  };

  const printMeta = user
    ? `Printed ${new Date().toLocaleString('en-IN')} by ${user.name} · Store: ${filters.storeId === 'all' ? 'All stores' : storeName(filters.storeId)} · Status: ${filters.status === 'all' ? 'All statuses' : filters.status}${filters.query ? ` · Search: "${filters.query}"` : ''}`
    : '';

  return (
    <>
      <a className="visually-hidden-focusable" href="#main">Skip to main content</a>

      <nav className="navbar navbar-expand-lg bg-body-tertiary border-bottom no-print" aria-label="Main">
        <div className="container-fluid">
          <span className="navbar-brand fw-semibold">
            InventorySync <span className="badge text-bg-secondary align-middle">React</span>
          </span>
          <button className="navbar-toggler" type="button" aria-controls="navMenu" aria-expanded={navOpen}
            aria-label="Toggle menu" onClick={() => setNavOpen(!navOpen)}>
            <span className="navbar-toggler-icon" />
          </button>
          <div className={`collapse navbar-collapse${navOpen ? ' show' : ''}`} id="navMenu">
            <div className="ms-lg-auto d-flex flex-column flex-lg-row gap-2 align-items-stretch align-items-lg-center py-2 py-lg-0">
              {user && (
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <label htmlFor="userSwitch" className="small mb-0">Signed in as</label>
                  <select id="userSwitch" className="form-select form-select-sm user-switch" value={user.id}
                    onChange={(e) => signIn(e.target.value)}>
                    {state.users.map((u) => <option key={u.id} value={u.id}>{userLabel(state, u)}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => signIn(null)}>Sign out</button>
                </div>
              )}
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={toggleTheme}>
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={onReset}>Reset data</button>
            </div>
          </div>
        </div>
      </nav>

      {banners.length > 0 && (
        <div className="container-fluid pt-3 no-print">
          {banners.map((b, i) => (
            <div key={i} className="alert alert-warning alert-dismissible" role="alert">
              {b}
              <button type="button" className="btn-close" aria-label="Close"
                onClick={() => setBanners((list) => list.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}

      <main id="main" className="container-fluid py-3">
        {!user && <SignIn users={state.users} storeName={storeName} onSignIn={signIn} />}

        {user && (
          <>
            <div className="d-none d-print-block mb-3">
              <h1 className="h4 mb-1">InventorySync stock report</h1>
              <p className="small mb-0">{printMeta}</p>
            </div>
            <h1 className="visually-hidden">InventorySync dashboard</h1>

            <SummaryCards summary={summary} />

            <div className="row g-3">
              <div className="col-12 col-lg-8">
                <section className="card" aria-labelledby="stockHeading">
                  <div className="card-header d-flex flex-wrap gap-2 align-items-center justify-content-between">
                    <h2 id="stockHeading" className="h5 mb-0">Stock by store</h2>
                    <div className="d-flex flex-wrap gap-2 no-print">
                      {can(user, 'addProduct', null) && (
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setDialog({ type: 'product' })}>
                          Add product
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onExport}>Export CSV</button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>Print / PDF</button>
                      {canSell && (
                        <button type="button" className="btn btn-sm btn-primary d-lg-none" aria-expanded={cartOpen}
                          onClick={() => setCartOpen(true)}>
                          Cart <span className="badge text-bg-light">{cartCount(cart)}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="card-body">
                    <Filters stores={state.stores} filters={filters} onChange={setFilters} />
                    <p className="small text-body-secondary mb-2" aria-live="polite">
                      Showing {visibleRows.length} of {allRows.length} store × SKU rows.
                    </p>
                    <StockTable rows={visibleRows} user={user} onAction={onAction} />
                  </div>
                </section>
              </div>

              <div className="col-12 col-lg-4">
                <AlertPanel alerts={alerts} />
                {canSell && (
                  <Cart
                    state={state}
                    storeId={user.storeId}
                    storeName={storeName(user.storeId)}
                    cart={cart}
                    errors={cartErrors}
                    open={cartOpen}
                    onClose={() => setCartOpen(false)}
                    onQtyChange={(sku, qty) => setCart({ ...cart, [sku]: qty })}
                    onRemove={(sku) => {
                      const next = { ...cart };
                      delete next[sku];
                      setCart(next);
                    }}
                    onClear={() => {
                      setCart({});
                      setCartErrors([]);
                    }}
                    onCheckout={onCheckout}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {user && dialog && dialog.type === 'receive' && (
        <ReceiveDialog state={state} storeId={dialog.storeId} sku={dialog.sku} onClose={closeDialog}
          onConfirm={({ qty }) => finish(runWrite((s) => receive(s, user, dialog.storeId, dialog.sku, qty),
            `Received ${qty} × ${findProduct(state, dialog.sku).name} at ${storeName(dialog.storeId)}.`))} />
      )}
      {user && dialog && dialog.type === 'transfer' && (
        <TransferDialog state={state} storeId={dialog.storeId} sku={dialog.sku} onClose={closeDialog}
          onConfirm={({ toId, qty }) => finish(runWrite((s) => transfer(s, user, dialog.storeId, toId, dialog.sku, qty),
            `Moved ${qty} × ${findProduct(state, dialog.sku).name} from ${storeName(dialog.storeId)} to ${storeName(toId)}.`))} />
      )}
      {user && dialog && dialog.type === 'reorder' && (
        <ReorderDialog state={state} storeId={dialog.storeId} sku={dialog.sku} onClose={closeDialog}
          onConfirm={({ level }) => finish(runWrite((s) => setReorderLevel(s, user, dialog.storeId, dialog.sku, level),
            `Reorder level for ${findProduct(state, dialog.sku).name} at ${storeName(dialog.storeId)} is now ${level}.`))} />
      )}
      {user && dialog && dialog.type === 'product' && (
        <ProductDialog onClose={closeDialog}
          onConfirm={(input) => finish(runWrite((s) => addProduct(s, user, input),
            `Added product ${String(input.sku).trim().toUpperCase()}.`))} />
      )}

      <div className="toast-container position-fixed bottom-0 end-0 p-3 no-print">
        {toasts.map((t) => (
          <div key={t.id} className={`toast show align-items-center text-bg-${t.type} border-0`}
            role={t.type === 'danger' ? 'alert' : 'status'} aria-live={t.type === 'danger' ? 'assertive' : 'polite'} aria-atomic="true">
            <div className="d-flex">
              <div className="toast-body">{t.message}</div>
              <button type="button" className="btn-close btn-close-white me-2 m-auto" aria-label="Close"
                onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
