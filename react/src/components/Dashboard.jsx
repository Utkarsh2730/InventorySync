import { can } from '../../../js/inventory.js';
import { BADGE_CLASS, inr } from '../format.js';

export function StatusBadge({ status }) {
  return <span className={`badge ${BADGE_CLASS[status]}`}>{status}</span>;
}

export function SignIn({ users, storeName, onSignIn }) {
  return (
    <section aria-labelledby="signInHeading" className="row justify-content-center">
      <div className="col-12 col-md-8 col-lg-5">
        <div className="card">
          <div className="card-body">
            <h1 id="signInHeading" className="h4">Sign in as a sample user</h1>
            <p className="text-body-secondary small mb-3">
              Simulated sign-in for the demo: no passwords. Each browser tab remembers its own user,
              so you can open two tabs as two different people.
            </p>
            <div className="list-group">
              {users.map((u) => (
                <button key={u.id} type="button" className="list-group-item list-group-item-action" onClick={() => onSignIn(u.id)}>
                  <span className="fw-semibold d-block">{u.name}</span>
                  <span className="small text-body-secondary">
                    {u.role === 'manager' ? 'Store Manager' : 'Inventory Buyer'} · {u.storeId ? storeName(u.storeId) : 'all stores'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SummaryCards({ summary }) {
  return (
    <section className="row g-3 mb-3" aria-label="Summary across all stores">
      <div className="col-12 col-sm-6 col-xl-3">
        <div className="card h-100"><div className="card-body">
          <p className="small text-body-secondary mb-1">Total SKUs</p>
          <p className="h3 mb-0">{summary.totalSkus}</p>
        </div></div>
      </div>
      <div className="col-12 col-sm-6 col-xl-3">
        <div className="card h-100 border-warning"><div className="card-body">
          <p className="small text-body-secondary mb-1">Low (store × SKU)</p>
          <p className="h3 mb-0">{summary.low} <span className="badge text-bg-warning align-middle fs-6">Low</span></p>
        </div></div>
      </div>
      <div className="col-12 col-sm-6 col-xl-3">
        <div className="card h-100 border-danger"><div className="card-body">
          <p className="small text-body-secondary mb-1">Out (store × SKU)</p>
          <p className="h3 mb-0">{summary.out} <span className="badge text-bg-danger align-middle fs-6">Out</span></p>
        </div></div>
      </div>
      <div className="col-12 col-sm-6 col-xl-3">
        <div className="card h-100"><div className="card-body">
          <p className="small text-body-secondary mb-1">Stock value</p>
          <p className="h3 mb-0">{inr.format(summary.stockValue)}</p>
        </div></div>
      </div>
    </section>
  );
}

export function Filters({ stores, filters, onChange }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  return (
    <form className="row g-2 mb-2 no-print" role="search" aria-label="Filter stock" onSubmit={(e) => e.preventDefault()}>
      <div className="col-12 col-md-6">
        <label htmlFor="searchInput" className="form-label small mb-1">Search by name or SKU</label>
        <div className="input-group">
          <span className="input-group-text" aria-hidden="true">⌕</span>
          <input id="searchInput" type="search" className="form-control" placeholder="e.g. ghee or TOOR-1KG"
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
          <option value="all">All statuses</option>
          <option value="OK">OK</option>
          <option value="Low">Low</option>
          <option value="Out">Out</option>
        </select>
      </div>
    </form>
  );
}

// Buttons appear only when can() allows them. That is a convenience: the rule
// functions call can() again and refuse anyway.
function RowActions({ user, row, onAction }) {
  const btn = (action, label, style, disabled = false) => (
    <button key={action} type="button" className={`btn btn-sm ${style} me-1`} disabled={disabled}
      aria-label={`${label}: ${row.name} at ${row.storeName}`} onClick={() => onAction(action, row.storeId, row.sku)}>
      {label}
    </button>
  );
  const buttons = [];
  if (can(user, 'sell', row.storeId)) buttons.push(btn('sell', 'Add to cart', 'btn-primary', row.qty === 0));
  if (can(user, 'receive', row.storeId)) buttons.push(btn('receive', 'Receive', 'btn-outline-primary'));
  if (can(user, 'transfer', row.storeId)) buttons.push(btn('transfer', 'Transfer', 'btn-outline-primary', row.qty === 0));
  if (can(user, 'setReorder', row.storeId)) buttons.push(btn('reorder', 'Reorder level', 'btn-outline-secondary'));
  return buttons.length ? buttons : <span className="text-body-secondary small">View only</span>;
}

export function StockTable({ rows, user, onAction }) {
  return (
    <div className="table-responsive">
      <table className="table table-sm table-hover align-middle mb-0">
        <caption className="visually-hidden">Stock per store and SKU, with the chain total for each SKU</caption>
        <thead>
          <tr>
            <th scope="col">Store</th>
            <th scope="col">SKU</th>
            <th scope="col">Product</th>
            <th scope="col" className="text-end d-none d-md-table-cell print-cell">Price</th>
            <th scope="col" className="text-end">Qty</th>
            <th scope="col" className="text-end d-none d-md-table-cell print-cell">Reorder at</th>
            <th scope="col">Status</th>
            <th scope="col" className="text-end">Chain total</th>
            <th scope="col" className="text-end d-none d-md-table-cell print-cell">Value</th>
            <th scope="col" className="no-print">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={10} className="text-center text-body-secondary py-4">No items match these filters.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.storeId}|${r.sku}`}>
              <td>{r.storeName}</td>
              <td><code>{r.sku}</code></td>
              <td className="product-name">{r.name}</td>
              <td className="text-end d-none d-md-table-cell print-cell">{inr.format(r.price)}</td>
              <td className="text-end qty-cell fw-semibold">{r.qty}</td>
              <td className="text-end qty-cell d-none d-md-table-cell print-cell">{r.reorderLevel}</td>
              <td><StatusBadge status={r.status} /></td>
              <td className="text-end qty-cell">{r.chainTotal}</td>
              <td className="text-end d-none d-md-table-cell print-cell">{inr.format(r.value)}</td>
              <td className="actions-cell no-print"><RowActions user={user} row={r} onAction={onAction} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AlertPanel({ alerts }) {
  return (
    <section className="card mb-3" aria-labelledby="alertHeading">
      <div className="card-header d-flex align-items-center justify-content-between">
        <h2 id="alertHeading" className="h5 mb-0">Alerts</h2>
        <span className="badge text-bg-secondary">{alerts.length}</span>
      </div>
      <ul className="list-group list-group-flush alert-list" aria-live="polite">
        {alerts.length === 0 && (
          <li className="list-group-item text-body-secondary">Nothing needs action. All items are above their reorder level.</li>
        )}
        {alerts.map((a) => (
          <li key={`${a.storeId}|${a.sku}`} className="list-group-item d-flex gap-2 align-items-start">
            <StatusBadge status={a.status} />
            <div>
              <div className="fw-semibold">{a.name}</div>
              <div className="small text-body-secondary">{a.storeName}: {a.qty} left (reorder at {a.reorderLevel})</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
