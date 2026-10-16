// bill.js: the customer's bill, drawn from a bill returned by checkout().
// The same element is shown in the Bill dialog and printed on its own
// (style.css hides everything else while a bill prints). It is 80 mm wide,
// so it suits a receipt printer and also prints neatly on A4.

import { h, inr } from './ui.js';

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
        h('td', {}, l.name, l.brand ? h('span', { class: 'bill-brand' }, l.brand) : null),
        h('td', { class: 'num' }, l.qty),
        h('td', { class: 'num' }, inr.format(l.price)),
        h('td', { class: 'num' }, inr.format(l.amount))))),
      h('tfoot', {},
        h('tr', {},
          h('td', {}, `${bill.itemCount} item${bill.itemCount === 1 ? '' : 's'}`),
          h('td', { colspan: '2', class: 'num' }, 'Total'),
          h('td', { class: 'num bill-total' }, inr.format(bill.total))))),
    h('footer', { class: 'bill-foot' }, 'Thank you for shopping with us.'));
}
