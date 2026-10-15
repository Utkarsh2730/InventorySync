// export.js: CSV export of the rows currently shown in the stock table (R10).
// Hand-written CSV, no library. A UTF-8 BOM is added so Excel shows the
// ₹ sign in the headers correctly.

const BOM = '﻿';

export const CSV_HEADERS = [
  'Store',
  'SKU',
  'Product',
  'Brand',
  'Price (₹)',
  'Qty',
  'Reorder level',
  'Status',
  'Stock value (₹)',
  'All stores total',
];

// Quote a cell when it contains a comma, quote or line break, doubling any
// quotes inside. Text starting with = + - @ is prefixed with ' so a
// spreadsheet does not run it as a formula.
export function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function toCsv(headers, records) {
  const lines = [headers, ...records].map((cells) => cells.map(escapeCsvCell).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

// Turn table rows (from inventory.buildRows/filterRows) into CSV text.
// includeChainTotal follows the screen: the all-stores total column is only
// shown (and exported) when the table is not limited to one store.
export function rowsToCsv(rows, { includeChainTotal = true } = {}) {
  const headers = includeChainTotal ? CSV_HEADERS : CSV_HEADERS.slice(0, -1);
  const records = rows.map((r) => {
    const cells = [r.storeName, r.sku, r.name, r.brand, r.price, r.qty, r.reorderLevel, r.status, r.value];
    if (includeChainTotal) cells.push(r.chainTotal);
    return cells;
  });
  return toCsv(headers, records);
}

function todayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Download the given rows as inventorysync-YYYY-MM-DD.csv.
export function downloadRowsAsCsv(rows, options) {
  const csv = rowsToCsv(rows, options);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inventorysync-${todayStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
