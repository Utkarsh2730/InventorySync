import { ROLE_LABELS, findStore } from '../../js/inventory.js';

export const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function storeNameOf(state, storeId) {
  const s = findStore(state, storeId);
  return s ? s.name : storeId;
}

export function userLabel(state, u) {
  const where = u.storeId ? storeNameOf(state, u.storeId) : 'all stores';
  return `${u.name}: ${ROLE_LABELS[u.role]}, ${where}`;
}

export const BADGE_CLASS = { OK: 'text-bg-success', Low: 'text-bg-warning', Out: 'text-bg-danger' };
