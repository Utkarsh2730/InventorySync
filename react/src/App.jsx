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
  defaultStoreFor,
  setSelling,
  findAccount,
  normalizeLoginId,
  userFromSession,
  signInAccount,
  productLabel,
} from '../../js/inventory.js';
import { downloadRowsAsCsv } from '../../js/export.js';
import { useInventory } from './useInventory.js';
import { hashForAccount, isCryptoAvailable } from '../../js/crypto.js';
import { storeNameOf, userLabel } from './format.js';
import { SignIn, SummaryCards, Filters, StockTable, AlertPanel } from './components/Dashboard.jsx';
import { Cart, cartCount } from './components/Cart.jsx';
import { ReceiveDialog, TransferDialog, ReorderDialog, ProductDialog } from './components/Dialogs.jsx';

// sessionStorage: { loginId, hash } of the shop login this tab signed in
// with. The user is worked out from it on every render, so a disabled login
// or a new password from the admin page signs the shop out.
const SESSION_KEY = 'inventorysync:shopSession';
const THEME_KEY = 'inventorysync:theme';

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // sessionStorage blocked: sign in again after a refresh
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
  const { state, notice, loadError, latest, write } = useInventory();
  const [theme, toggleTheme] = useTheme();
  const [session, setSession] = useState(readSession); // { loginId, hash } or null
  const [signInErrors, setSignInErrors] = useState([]);
  const [filters, setFilters] = useState({ query: '', storeId: 'all', status: 'all' });
  const [cart, setCart] = useState({}); // sku -> qty, in memory for this tab
  const [cartErrors, setCartErrors] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { type, storeId, sku }
  const [toasts, setToasts] = useState([]);
  const [banners, setBanners] = useState([]);

  const user = state && session ? userFromSession(state, session.loginId, session.hash) : null;
  const storeName = useCallback((id) => storeNameOf(state, id), [state]);

  useEffect(() => {
    if (notice) setBanners((b) => [...b, notice]);
  }, [notice]);

  // The admin disabled this login or changed its password: sign the shop out.
  const sessionIsDead = Boolean(state && session && !user);
  useEffect(() => {
    if (!sessionIsDead) return;
    writeSession(null);
    setSession(null);
    setCart({});
    setSignInErrors(['You were signed out: head office disabled this login or changed its password.']);
  }, [sessionIsDead]);

  const toast = useCallback((message, type = 'success') => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'danger' ? 6000 : 3500);
  }, []);

  // Start each user on their own view: a manager sees their store, the buyer all stores.
  const userKey = user ? user.id : null;
  useEffect(() => {
    setFilters({ query: '', storeId: defaultStoreFor(user), status: 'all' });
    // Only when the signed-in user changes, not on every stock update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  // The Store filter sets the scope for the cards, the alerts and the table.
  const scopeStore = filters.storeId;
  // Every row of the chosen store (including stopped items); the filters
  // then pick what is shown.
  const scopeRows = useMemo(
    () => (state ? buildRows(state).filter((r) => scopeStore === 'all' || r.storeId === scopeStore) : []),
    [state, scopeStore],
  );
  const visibleRows = useMemo(() => filterRows(scopeRows, filters), [scopeRows, filters]);
  const summary = useMemo(() => (state ? summarize(state, scopeStore) : null), [state, scopeStore]);
  const alerts = useMemo(() => (state ? alertsOf(state, scopeStore) : []), [state, scopeStore]);
  const showChainTotal = scopeStore === 'all';

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

  // Shop sign-in with the Shop ID and password from head office. The password
  // is hashed with the account's salt (crypto.js); inventory.js compares.
  const signIn = async (typedId, password) => {
    if (!isCryptoAvailable()) {
      setSignInErrors(['This page cannot check passwords here. Open it over https:// or from localhost.']);
      return false;
    }
    const loginId = normalizeLoginId(typedId);
    const account = findAccount(latest(), loginId);
    const hash = account ? await hashForAccount(password, account) : null;
    const result = write((s) => signInAccount(s, loginId, hash, new Date().toISOString()));
    if (!result.ok) {
      setSignInErrors(result.errors);
      return false;
    }
    const next = { loginId, hash };
    writeSession(next);
    setSession(next);
    setSignInErrors([]);
    setCart({});
    setCartErrors([]);
    toast(`Signed in as ${result.user.name}.`);
    return true;
  };

  const signOut = () => {
    writeSession(null);
    setSession(null);
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
    const name = productLabel(findProduct(fresh, sku));
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

  // One click, no dialog: stop or resume selling an item at this shop.
  const onSetSelling = (storeId, sku, selling) => {
    const name = productLabel(findProduct(state, sku));
    const result = runWrite((s) => setSelling(s, user, storeId, sku, selling),
      selling ? `${name} is on sale again at ${storeName(storeId)}.` : `Stopped selling ${name} at ${storeName(storeId)}. Find it under "Stopped selling".`);
    if (!result.ok) toast(result.errors[0], 'danger');
    else if (!selling) {
      setCart((c) => {
        const next = { ...c };
        delete next[sku];
        return next;
      });
    }
  };

  const onAction = (action, storeId, sku) => {
    if (action === 'sell') addToCart(storeId, sku);
    else if (action === 'stop') onSetSelling(storeId, sku, false);
    else if (action === 'resume') onSetSelling(storeId, sku, true);
    else setDialog({ type: action, storeId, sku });
  };

  const canStop = user ? can(user, 'setSelling', user.storeId) : false;
  const showingStopped = filters.status === 'Stopped';
  const toggleStopped = () => setFilters(showingStopped
    ? { ...filters, status: 'all' }
    : { ...filters, status: 'Stopped', storeId: user.storeId });

  const closeDialog = () => setDialog(null);
  const finish = (result) => {
    if (result.ok) closeDialog();
    return result;
  };

  const onExport = () => {
    if (visibleRows.length === 0) {
      toast('No rows to export with these filters.', 'danger');
      return;
    }
    downloadRowsAsCsv(visibleRows, { includeChainTotal: showChainTotal });
    toast(`Exported ${visibleRows.length} rows to CSV.`);
  };

  const scopeName = scopeStore === 'all' ? 'All stores' : storeName(scopeStore);

  const printMeta = user
    ? `Printed ${new Date().toLocaleString('en-IN')} by ${user.name} · Store: ${scopeName} · Status: ${{ all: 'All items on sale', Stopped: 'Stopped selling' }[filters.status] || filters.status}${filters.query ? ` · Search: "${filters.query}"` : ''}`
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
                  <span className="small text-body-secondary">Signed in:</span>
                  <span className="small fw-semibold">{userLabel(state, user)}</span>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={signOut}>Sign out</button>
                </div>
              )}
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={toggleTheme}>
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
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
        {!user && <SignIn errors={signInErrors} onSignIn={signIn} />}

        {user && (
          <>
            <div className="d-none d-print-block mb-3">
              <h1 className="h4 mb-1">InventorySync stock report</h1>
              <p className="small mb-0">{printMeta}</p>
            </div>
            <h1 className="visually-hidden">InventorySync dashboard</h1>

            <SummaryCards summary={summary} scopeName={scopeName} />

            <div className="row g-3">
              <div className="col-12 col-lg-9 main-panel">
                <section className="card" aria-labelledby="stockHeading">
                  <div className="card-header d-flex flex-wrap gap-2 align-items-center justify-content-between">
                    <h2 id="stockHeading" className="h5 mb-0">Stock by store</h2>
                    <div className="d-flex flex-wrap gap-2 no-print">
                      {can(user, 'addProduct', null) && (
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setDialog({ type: 'product' })}>
                          Add product
                        </button>
                      )}
                      {canStop && (
                        <button type="button" className="btn btn-sm btn-outline-secondary" aria-pressed={showingStopped} onClick={toggleStopped}>
                          {showingStopped ? 'Show items on sale' : `Stopped selling (${summarize(state, user.storeId).stopped})`}
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
                      Showing {visibleRows.length} of {scopeRows.length} items · {scopeName}
                    </p>
                    <StockTable rows={visibleRows} user={user} onAction={onAction} showChainTotal={showChainTotal}
                      emptyText={showingStopped ? 'This shop has not stopped selling any items. Use "Stop" on a row to stop selling an item.' : 'No items match these filters.'} />
                  </div>
                </section>
              </div>

              <div className="col-12 col-lg-3 side-panel">
                <AlertPanel alerts={alerts} scopeName={scopeName} />
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
            `Received ${qty} × ${productLabel(findProduct(state, dialog.sku))} at ${storeName(dialog.storeId)}.`))} />
      )}
      {user && dialog && dialog.type === 'transfer' && (
        <TransferDialog state={state} storeId={dialog.storeId} sku={dialog.sku} onClose={closeDialog}
          onConfirm={({ toId, qty }) => finish(runWrite((s) => transfer(s, user, dialog.storeId, toId, dialog.sku, qty),
            `Moved ${qty} × ${productLabel(findProduct(state, dialog.sku))} from ${storeName(dialog.storeId)} to ${storeName(toId)}.`))} />
      )}
      {user && dialog && dialog.type === 'reorder' && (
        <ReorderDialog state={state} storeId={dialog.storeId} sku={dialog.sku} onClose={closeDialog}
          onConfirm={({ level }) => finish(runWrite((s) => setReorderLevel(s, user, dialog.storeId, dialog.sku, level),
            `Reorder level for ${productLabel(findProduct(state, dialog.sku))} at ${storeName(dialog.storeId)} is now ${level}.`))} />
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
