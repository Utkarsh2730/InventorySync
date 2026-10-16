// bill.js: the customer's bill, drawn from a bill returned by checkout().
// The same element is shown in the Bill dialog and printed on its own
// (style.css hides everything else while a bill prints). It is 80 mm wide,
// so it suits a receipt printer and also prints neatly on A4.

import { h, inr, inrTax } from './ui.js';
import { formatRate } from './gst.js';

// GST summary: how much of the total is tax, per rate (CGST + SGST).
// Bills made before GST rates existed have no summary.
function taxSummary(bill) {
  if (!Array.isArray(bill.taxes) || bill.taxes.length === 0) return null;
  return h('table', { class: 'bill-tax' },
    h('caption', {}, 'GST included in the prices'),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'GST'),
      h('th', { scope: 'col', class: 'num' }, 'Taxable'),
      h('th', { scope: 'col', class: 'num' }, 'CGST'),
      h('th', { scope: 'col', class: 'num' }, 'SGST'))),
    h('tbody', {}, bill.taxes.map((t) => h('tr', {},
      h('td', {}, formatRate(t.rate)),
      h('td', { class: 'num' }, inrTax.format(t.taxable)),
      h('td', { class: 'num' }, inrTax.format(t.cgst)),
      h('td', { class: 'num' }, inrTax.format(t.sgst))))),
    h('tfoot', {}, h('tr', {},
      h('td', { colspan: '3' }, 'Total GST'),
      h('td', { class: 'num' }, inrTax.format(bill.taxTotal)))));
}

export function billElement(bill) {
  const when = new Date(bill.time).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const meta = [
    ['Bill no.', bill.number],
    ['Date', when],
    ['Sold by', bill.soldBy],
    bill.customer ? ['Customer', bill.customer] : null,
    ['Paid by', bill.payment],
  ].filter(Boolean);

  return h('article', { class: 'bill', 'aria-label': `Bill ${bill.number}` },
    h('header', { class: 'bill-head' },
      h('div', { class: 'bill-shop' }, bill.storeName),
      bill.city ? h('div', {}, bill.city) : null,
      h('div', { class: 'bill-title' }, 'BILL')),
    h('dl', { class: 'bill-meta' }, meta.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('table', { class: 'bill-lines' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Item'),
        h('th', { scope: 'col', class: 'num' }, 'Qty'),
        h('th', { scope: 'col', class: 'num' }, 'Rate'),
        h('th', { scope: 'col', class: 'num' }, 'Amount'))),
      h('tbody', {}, bill.lines.map((l) => h('tr', {},
        h('td', {}, l.name, h('span', { class: 'bill-brand' },
          [l.brand, l.hsn ? `HSN ${l.hsn}` : null, l.gstRate === undefined ? null : `GST ${formatRate(l.gstRate)}`].filter(Boolean).join(' · '))),
        h('td', { class: 'num' }, l.qty),
        h('td', { class: 'num' }, inr.format(l.price)),
        h('td', { class: 'num' }, inr.format(l.amount))))),
      h('tfoot', {},
        h('tr', {},
          h('td', {}, `${bill.itemCount} item${bill.itemCount === 1 ? '' : 's'}`),
          h('td', { colspan: '2', class: 'num' }, 'Total'),
          h('td', { class: 'num bill-total' }, inr.format(bill.total))))),
    taxSummary(bill),
    h('footer', { class: 'bill-foot' }, 'Thank you for shopping with us.'));
}
