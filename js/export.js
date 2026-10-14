// export.js: CSV export of the rows currently shown in the stock table (R10).
// Hand-written CSV, no library. A UTF-8 BOM is added so Excel shows ₹ and
// Indian-language product names correctly.

const BOM = '﻿';

export const CSV_HEADERS = [
  'Store',
  'SKU',
  'Product',
  'Price (₹)',
  'Qty',
  'Reorder level',
  'Status',
  'Stock value (₹)',
  'Chain total',
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
export function rowsToCsv(rows) {
  const records = rows.map((r) => [
    r.storeName,
    r.sku,
    r.name,
    r.price,
    r.qty,
    r.reorderLevel,
    r.status,
    r.value,
    r.chainTotal,
  ]);
  return toCsv(CSV_HEADERS, records);
}

function todayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Download the given rows as inventorysync-YYYY-MM-DD.csv.
export function downloadRowsAsCsv(rows) {
  const csv = rowsToCsv(rows);
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
