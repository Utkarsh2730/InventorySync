import { useState } from 'react';
import { can, productLabel } from '../../../js/inventory.js';
import { BADGE_CLASS, inr } from '../format.js';

export function StatusBadge({ status }) {
  return <span className={`badge status-badge ${BADGE_CLASS[status]}`}>{status}</span>;
}

// Shop sign-in with the Shop ID and password from head office (no admin
// sign-in here).
export function SignIn({ errors, onSignIn, needsSetup }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const settingUp = needsSetup(loginId);
  const [showPassword, setShowPassword] = useState(false);
  const [validated, setValidated] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setValidated(true);
    if (!e.currentTarget.checkValidity()) return;
    setBusy(true);
    const ok = await onSignIn(loginId, password, confirm);
    setBusy(false);
    setPassword('');
    setConfirm('');
    if (ok) {
      setLoginId('');
      setValidated(false);
    }
  };
  return (
    <section aria-labelledby="signInHeading" className="row justify-content-center">
      <div className="col-12 col-md-8 col-lg-5">
        <div className="card">
          <div className="card-body">
            <h1 id="signInHeading" className="h4">Shop sign in</h1>
            <p className="text-body-secondary small mb-3">Use the Shop ID and password your head office gave your shop.</p>
            <form noValidate className={validated ? 'was-validated' : ''} onSubmit={submit}>
              {errors.length > 0 && (
                <div className="alert alert-danger" role="alert">
                  <p className="fw-semibold mb-1">Refused. Nothing was changed:</p>
                  <ul className="mb-0">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              <div className="mb-3">
                <label htmlFor="loginId" className="form-label">Shop ID</label>
                <input id="loginId" type="text" className="form-control" required minLength={3} maxLength={32}
                  autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="e.g. koramangala"
                  value={loginId} onChange={(e) => setLoginId(e.target.value)} />
                <div className="invalid-feedback">Enter your Shop ID.</div>
              </div>
              <div className="mb-3">
                <label htmlFor="loginPassword" className="form-label">Password</label>
                <div className="input-group has-validation">
                  <input id="loginPassword" type={showPassword ? 'text' : 'password'} className="form-control" required maxLength={128}
                    autoComplete="current-password" spellCheck={false}
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="btn btn-outline-secondary" aria-controls="loginPassword" aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
                  <div className="invalid-feedback">Enter your password.</div>
                </div>
              </div>
              {settingUp && (
                // Only when a password is being chosen for the first time.
                <div className="mb-3">
                  <label htmlFor="loginPasswordConfirm" className="form-label">Type the password again</label>
                  <input id="loginPasswordConfirm" type="password" className="form-control" required maxLength={128}
                    autoComplete="new-password" spellCheck={false} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
              )}
              <button type="submit" className="btn btn-primary w-100" disabled={busy}>{settingUp ? 'Save password and sign in' : 'Sign in'}</button>
            </form>
            <div className="mt-3">
              <button type="button" className="btn btn-link btn-sm p-0" aria-expanded={forgotOpen} onClick={() => setForgotOpen(!forgotOpen)}>Forgot password?</button>
              {forgotOpen && (
                <p className="small mt-2 mb-0">Ask head office to reset your password. They will give you a new one, and you can then change it to one only you know.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SummaryCards({ summary, scopeName }) {
  return (
    <>
    <h2 className="h6 text-body-secondary mb-2">Summary · <span id="summaryScope">{scopeName}</span></h2>
    <section className="row g-3 mb-3" aria-labelledby="summaryScope">
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card h-100"><div className="card-body">
          <p className="small text-body-secondary mb-1">Products</p>
          <p className="h3 mb-0">{summary.totalSkus}</p>
        </div></div>
      </div>
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card h-100 border-warning"><div className="card-body">
          <p className="small text-body-secondary mb-1">Low stock items</p>
          <p className="h3 mb-0">{summary.low} <span className="badge text-bg-warning align-middle fs-6">Low</span></p>
        </div></div>
      </div>
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card h-100 border-danger"><div className="card-body">
          <p className="small text-body-secondary mb-1">Out of stock items</p>
          <p className="h3 mb-0">{summary.out} <span className="badge text-bg-danger align-middle fs-6">Out</span></p>
        </div></div>
      </div>
      <div className="col-12 col-sm-6 col-lg-3">
        <div className="card h-100"><div className="card-body">
          <p className="small text-body-secondary mb-1">Stock value</p>
          <p className="h3 mb-0">{inr.format(summary.stockValue)}</p>
        </div></div>
      </div>
    </section>
    </>
  );
}

export function Filters({ stores, filters, onChange }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  return (
    <form className="row g-2 mb-2 no-print" role="search" aria-label="Filter stock" onSubmit={(e) => e.preventDefault()}>
      <div className="col-12 col-md-6">
        <label htmlFor="searchInput" className="form-label small mb-1">Search by name, brand or SKU</label>
        <div className="input-group">
          <span className="input-group-text" aria-hidden="true">⌕</span>
          <input id="searchInput" type="search" className="form-control" placeholder="e.g. ghee, Amul or TOOR-1KG"
            autoComplete="off" value={filters.query} onChange={set('query')} />
          <button type="button" className="btn btn-outline-secondary"
            onClick={() => onChange({ query: '', storeId: 'all', status: 'all' })}>Clear</button>
        </div>
      </div>
      <div className="col-6 col-md-3">
        <label htmlFor="storeFilter" className="form-label small mb-1">Store</label>
        <select id="storeFilter" className="form-select" value={filters.storeId} onChange={set('storeId')}>
          <option value="all">All stores</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="col-6 col-md-3">
        <label htmlFor="statusFilter" className="form-label small mb-1">Status</label>
        <select id="statusFilter" className="form-select" value={filters.status} onChange={set('status')}>
          <option value="all">All items on sale</option>
          <option value="OK">OK</option>
          <option value="Low">Low</option>
          <option value="Out">Out</option>
          <option value="Stopped">Stopped selling</option>
        </select>
      </div>
    </form>
  );
}

// Buttons appear only when can() allows them. That is a convenience: the rule
// functions call can() again and refuse anyway.
function RowActions({ user, row, onAction }) {
  // label is the short button text; fullLabel is read out by screen readers.
  const btn = (action, label, style, disabled = false, fullLabel = label) => (
    <button key={action} type="button" className={`btn ${style}`} disabled={disabled}
      aria-label={`${fullLabel}: ${productLabel(row)} at ${row.storeName}`} onClick={() => onAction(action, row.storeId, row.sku)}>
      {label}
    </button>
  );
  const buttons = [];
  if (can(user, 'sell', row.storeId) && !row.stopped) buttons.push(btn('sell', 'Add to cart', 'btn-primary', row.qty === 0));
  if (can(user, 'receive', row.storeId)) buttons.push(btn('receive', 'Receive', 'btn-outline-primary'));
  if (can(user, 'transfer', row.storeId)) buttons.push(btn('transfer', 'Transfer', 'btn-outline-primary', row.qty === 0));
  if (can(user, 'setReorder', row.storeId)) buttons.push(btn('reorder', 'Reorder', 'btn-outline-secondary', false, 'Reorder level'));
  if (can(user, 'setSelling', row.storeId)) {
    buttons.push(row.stopped
      ? btn('resume', 'Resume', 'btn-outline-success', false, 'Resume selling')
      : btn('stop', 'Stop', 'btn-outline-secondary', false, 'Stop selling'));
  }
  if (buttons.length === 0) return <span className="text-body-secondary small">View only</span>;
  return (
    <div className="btn-group btn-group-sm row-actions" role="group" aria-label={`Actions for ${productLabel(row)} at ${row.storeName}`}>
      {buttons}
    </div>
  );
}

export function StockTable({ rows, user, onAction, showChainTotal, emptyText }) {
  return (
    <div className="table-responsive stock-scroll" tabIndex={0} role="region" aria-label="Stock list (scrolls)">
      <table className="table table-sm table-hover align-middle mb-0">
        <caption className="visually-hidden">Stock per store and SKU</caption>
        <thead>
          <tr>
            <th scope="col">Store</th>
            <th scope="col">SKU</th>
            <th scope="col">Product</th>
            <th scope="col" className="text-end d-none d-xl-table-cell print-cell">Price</th>
            <th scope="col" className="text-end">Qty</th>
            <th scope="col" className="text-end d-none d-xl-table-cell print-cell">Reorder<br />level</th>
            <th scope="col" className="text-center">Status</th>
            {showChainTotal && <th scope="col" className="text-end">All stores<br />total</th>}
            <th scope="col" className="text-end d-none d-xl-table-cell print-cell">Value</th>
            <th scope="col" className="no-print">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={10} className="text-center text-body-secondary py-4">{emptyText}</td></tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.storeId}|${r.sku}`} className={r.stopped ? 'row-stopped' : undefined}>
              <td>{r.storeName}</td>
              <td><code>{r.sku}</code></td>
              <td className="product-name">
                <div>{r.name}</div>
                <div className="product-brand">{r.brand}</div>
              </td>
              <td className="text-end d-none d-xl-table-cell print-cell">{inr.format(r.price)}</td>
              <td className="text-end qty-cell fw-semibold">{r.qty}</td>
              <td className="text-end qty-cell d-none d-xl-table-cell print-cell">{r.reorderLevel}</td>
              <td className="text-center"><StatusBadge status={r.status} /></td>
              {showChainTotal && <td className="text-end qty-cell">{r.chainTotal}</td>}
              <td className="text-end d-none d-xl-table-cell print-cell">{inr.format(r.value)}</td>
              <td className="actions-cell no-print"><RowActions user={user} row={r} onAction={onAction} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AlertPanel({ alerts, scopeName }) {
  return (
    <section className="card mb-3 alerts-card" aria-labelledby="alertHeading">
      <div className="card-header d-flex align-items-center justify-content-between">
        <h2 id="alertHeading" className="h5 mb-0">Alerts · {scopeName}</h2>
        <span className="badge text-bg-secondary">{alerts.length}</span>
      </div>
      <ul className="list-group list-group-flush alert-list" aria-live="polite">
        {alerts.length === 0 && (
          <li className="list-group-item text-body-secondary">Nothing needs action at {scopeName}. All items are above their reorder level.</li>
        )}
        {alerts.map((a) => (
          <li key={`${a.storeId}|${a.sku}`} className="list-group-item d-flex gap-2 align-items-start">
            <StatusBadge status={a.status} />
            <div>
              <div className="fw-semibold">{a.name}</div>
              <div className="small text-body-secondary">{a.brand} · {a.storeName}: {a.qty} left (reorder at {a.reorderLevel})</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
