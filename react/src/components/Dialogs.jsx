import { useState } from 'react';
import { findProduct, productLabel } from '../../../js/inventory.js';
import { GST_CATEGORIES, gstCategoryLabel } from '../../../js/gst.js';
import { storeNameOf } from '../format.js';
import Modal from './Modal.jsx';

// Same rule as ENGLISH_TEXT in inventory.js, written for the HTML pattern attribute.
const ENGLISH_PATTERN = "[A-Za-z0-9 .,'\"&\\(\\)\\/+%\\-]+";

// Each dialog collects input and calls onConfirm(values). onConfirm runs the
// rule from inventory.js and returns { ok, errors }; errors stay in the dialog.

function describe(state, storeId, sku) {
  const p = findProduct(state, sku);
  const entry = state.stock[storeId][sku];
  return `${productLabel(p)}, SKU ${sku}, at ${storeNameOf(state, storeId)}: ${entry.qty} in stock, reorder at ${entry.reorderLevel}.`;
}

function useConfirm(onConfirm) {
  const [errors, setErrors] = useState([]);
  const submit = (values) => {
    const result = onConfirm(values);
    setErrors(result.ok ? [] : result.errors);
  };
  return [errors, submit];
}

export function ReceiveDialog({ state, storeId, sku, onConfirm, onClose }) {
  const [qty, setQty] = useState('');
  const [errors, submit] = useConfirm(onConfirm);
  return (
    <Modal title="Receive stock" submitLabel="Receive" errors={errors} onClose={onClose}
      onSubmit={() => submit({ qty: Number(qty) })}>
      <p>{describe(state, storeId, sku)}</p>
      <label htmlFor="receiveQty" className="form-label">Quantity received</label>
      <input id="receiveQty" type="number" className="form-control" min="1" max="100000" step="1" required
        inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      <div className="invalid-feedback">Enter a whole number from 1 to 100000.</div>
    </Modal>
  );
}

export function TransferDialog({ state, storeId, sku, onConfirm, onClose }) {
  const [toId, setToId] = useState('');
  const [qty, setQty] = useState('');
  const [errors, submit] = useConfirm(onConfirm);
  const available = state.stock[storeId][sku].qty;
  return (
    <Modal title="Transfer stock" submitLabel="Transfer" errors={errors} onClose={onClose}
      onSubmit={() => submit({ toId, qty: Number(qty) })}>
      <p>From {describe(state, storeId, sku)}</p>
      <div className="mb-3">
        <label htmlFor="transferTo" className="form-label">Move to store</label>
        <select id="transferTo" className="form-select" required value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Choose a store…</option>
          {state.stores.filter((s) => s.id !== storeId).map((s) => (
            <option key={s.id} value={s.id}>{s.name} (has {state.stock[s.id][sku].qty})</option>
          ))}
        </select>
        <div className="invalid-feedback">Choose the store that receives the stock.</div>
      </div>
      <label htmlFor="transferQty" className="form-label">Quantity</label>
      <input id="transferQty" type="number" className="form-control" min="1" max={available} step="1" required
        inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      <div className="invalid-feedback">Enter a whole number from 1 to {available}.</div>
    </Modal>
  );
}

export function ReorderDialog({ state, storeId, sku, onConfirm, onClose }) {
  const [level, setLevel] = useState(String(state.stock[storeId][sku].reorderLevel));
  const [errors, submit] = useConfirm(onConfirm);
  return (
    <Modal title="Reorder level" submitLabel="Save level" errors={errors} onClose={onClose}
      onSubmit={() => submit({ level: Number(level) })}>
      <p>{describe(state, storeId, sku)}</p>
      <label htmlFor="reorderLevel" className="form-label">Show as Low at or below</label>
      <input id="reorderLevel" type="number" className="form-control" min="0" max="100000" step="1" required
        inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value)} />
      <div className="invalid-feedback">Enter a whole number from 0 to 100000.</div>
    </Modal>
  );
}

export function ProductDialog({ onConfirm, onClose }) {
  const [form, setForm] = useState({ sku: '', name: '', brand: '', price: '', reorderLevel: '', taxCategory: '' });
  const [errors, submit] = useConfirm(onConfirm);
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) });
  return (
    <Modal title="Add product" submitLabel="Add product" errors={errors} onClose={onClose}
      onSubmit={() => submit({ sku: form.sku, name: form.name, brand: form.brand, price: Number(form.price), reorderLevel: Number(form.reorderLevel), taxCategory: form.taxCategory })}>
      <p className="small text-body-secondary">The product starts at 0 in every store. Receive or transfer stock afterwards.</p>
      <div className="mb-3">
        <label htmlFor="productSku" className="form-label">SKU</label>
        <input id="productSku" type="text" className="form-control text-uppercase" required maxLength={24}
          pattern="[A-Za-z0-9][A-Za-z0-9\-]{1,23}" autoComplete="off" {...field('sku')} />
        <div className="invalid-feedback">2–24 letters, digits or dashes, starting with a letter or digit.</div>
      </div>
      <div className="mb-3">
        <label htmlFor="productName" className="form-label">Name</label>
        <input id="productName" type="text" className="form-control" required minLength={2} maxLength={80}
          autoComplete="off" placeholder="e.g. Toor Dal 1 kg" pattern={ENGLISH_PATTERN} {...field('name')} />
        <div className="invalid-feedback">2–80 characters, in English letters only.</div>
      </div>
      <div className="mb-3">
        <label htmlFor="productBrand" className="form-label">Brand</label>
        <input id="productBrand" type="text" className="form-control" required minLength={2} maxLength={40}
          autoComplete="off" placeholder="e.g. Tata Sampann" pattern={ENGLISH_PATTERN} {...field('brand')} />
        <div className="invalid-feedback">2–40 characters, in English letters only.</div>
        <div className="form-text">Stock the same item from another brand? Add it again with that brand and its own SKU.</div>
      </div>
      <div className="row g-3">
        <div className="col-6">
          <label htmlFor="productPrice" className="form-label">Price incl. GST (₹)</label>
          <input id="productPrice" type="number" className="form-control" required min="0" max="10000000" step="0.01"
            inputMode="decimal" {...field('price')} />
          <div className="invalid-feedback">Enter a price of 0 or more.</div>
        </div>
        <div className="col-6">
          <label htmlFor="productReorder" className="form-label">Reorder level</label>
          <input id="productReorder" type="number" className="form-control" required min="0" max="100000" step="1"
            inputMode="numeric" {...field('reorderLevel')} />
          <div className="invalid-feedback">Whole number, 0 or more.</div>
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="productGst" className="form-label">Type of product (GST)</label>
        <select id="productGst" className="form-select" required {...field('taxCategory')}>
          <option value="">Choose…</option>
          {GST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{gstCategoryLabel(c)}</option>)}
        </select>
        <div className="invalid-feedback">Choose the type of product.</div>
        <div className="form-text">The GST rate comes from the government's rate for this type of product. The price above includes GST.</div>
      </div>
    </Modal>
  );
}

// Change password: current, new, and new again. onConfirm may be async and
// returns { ok, errors }.
export function PasswordDialog({ context, onConfirm, onClose }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const field = (key) => ({ value: form[key], onChange: (e) => setForm({ ...form, [key]: e.target.value }) });
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const result = await onConfirm(form);
    setBusy(false);
    if (!result.ok) setErrors(result.errors);
  };
  return (
    <Modal title="Change password" submitLabel={busy ? 'Saving…' : 'Save new password'} errors={errors} onClose={onClose} onSubmit={submit}>
      <p className="small text-body-secondary">{context}</p>
      <div className="mb-3">
        <label htmlFor="currentPassword" className="form-label">Current password</label>
        <input id="currentPassword" type="password" className="form-control" required maxLength={128}
          autoComplete="current-password" spellCheck={false} {...field('current')} />
        <div className="invalid-feedback">Enter your current password.</div>
      </div>
      <div className="mb-3">
        <label htmlFor="newPassword" className="form-label">New password</label>
        <input id="newPassword" type="password" className="form-control" required minLength={8} maxLength={128}
          autoComplete="new-password" spellCheck={false} aria-describedby="newPasswordHelp" {...field('next')} />
        <div className="invalid-feedback">At least 8 characters.</div>
        <div id="newPasswordHelp" className="form-text">At least 8 characters. Do not reuse a password from another site.</div>
      </div>
      <label htmlFor="confirmPassword" className="form-label">Type the new password again</label>
      <input id="confirmPassword" type="password" className="form-control" required maxLength={128}
        autoComplete="new-password" spellCheck={false} {...field('confirm')} />
    </Modal>
  );
}
