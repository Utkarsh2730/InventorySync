import { findProduct, isPositiveInt } from '../../../js/inventory.js';
import { inr } from '../format.js';

// Large screens: a normal card. Below lg: an offcanvas panel (Bootstrap's
// offcanvas-lg classes, opened and closed with React state).
export function Cart({ state, storeId, storeName, cart, errors, open, onClose, onQtyChange, onRemove, onClear, onCheckout }) {
  const lines = Object.entries(cart);
  let total = 0;
  for (const [sku, qty] of lines) {
    const p = findProduct(state, sku);
    if (p && isPositiveInt(qty)) total += p.price * qty;
  }

  return (
    <div className="no-print">
      <div className={`offcanvas-lg offcanvas-end${open ? ' show' : ''}`} tabIndex={-1} aria-labelledby="cartHeading"
        role={open ? 'dialog' : undefined} aria-modal={open ? 'true' : undefined}>
        <div className="offcanvas-header">
          <p className="offcanvas-title h5 mb-0" aria-hidden="true">Cart</p>
          <button type="button" className="btn-close" aria-label="Close cart" onClick={onClose} />
        </div>
        <div className="offcanvas-body">
          <section className="card w-100" aria-labelledby="cartHeading">
            <div className="card-header">
              <h2 id="cartHeading" className="h5 mb-0">Cart · {storeName}</h2>
            </div>
            <div className="card-body">
              {errors.length > 0 && (
                <div className="alert alert-danger" role="alert">
                  <p className="fw-semibold mb-1">Refused. Nothing was changed:</p>
                  <ul className="mb-0">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              {lines.length === 0 && (
                <p className="text-body-secondary small mb-2">The cart is empty. Use “Add to cart” on a row from your store.</p>
              )}
              <ul className="list-unstyled mb-3" id="cartLines">
                {lines.map(([sku, qty]) => {
                  const p = findProduct(state, sku);
                  const inputId = `cartQty-${sku}`;
                  return (
                    <li key={sku} className="border-bottom pb-2 mb-2">
                      <div className="d-flex justify-content-between gap-2">
                        <label htmlFor={inputId} className="fw-semibold">{p.name}</label>
                        <button type="button" className="btn btn-sm btn-link text-danger p-0"
                          aria-label={`Remove ${p.name} from cart`} onClick={() => onRemove(sku)}>Remove</button>
                      </div>
                      <div className="d-flex align-items-center gap-2 mt-1">
                        <input id={inputId} type="number" min="1" step="1" inputMode="numeric"
                          className={`form-control form-control-sm cart-qty${isPositiveInt(qty) ? '' : ' is-invalid'}`}
                          value={Number.isFinite(qty) ? qty : ''} aria-describedby={`${inputId}-help`}
                          onChange={(e) => onQtyChange(sku, e.target.value === '' ? NaN : Number(e.target.value))} />
                        <span id={`${inputId}-help`} className="small text-body-secondary">
                          {state.stock[storeId][sku].qty} in stock · {inr.format(p.price)} each
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="d-flex justify-content-between fw-semibold mb-3">
                <span>Total</span><span>{inr.format(total)}</span>
              </p>
              <div className="d-flex gap-2">
                <button type="button" className="btn btn-success flex-grow-1" disabled={lines.length === 0} onClick={onCheckout}>Checkout</button>
                <button type="button" className="btn btn-outline-secondary" disabled={lines.length === 0} onClick={onClear}>Clear</button>
              </div>
            </div>
          </section>
        </div>
      </div>
      {open && <div className="offcanvas-backdrop fade show d-lg-none" onClick={onClose} />}
    </div>
  );
}

export function cartCount(cart) {
  return Object.values(cart).reduce((n, q) => n + (isPositiveInt(q) ? q : 0), 0);
}
