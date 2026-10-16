// gst.js: GST rates as set by the Government of India, by product category.
//
// Nobody types a rate in the app. Each product is put in one category below
// (with its HSN code), and its rate always comes from this table. When the
// GST Council changes a rate, change it here once and every product, shop and
// new bill follows; bills already printed keep the rate they were made with.
//
// Rates: GST schedule in force from 22 September 2025 (slabs 0%, 5%, 18%, 40%).
// Prices in the app include GST, as on the MRP.

export const GST_SCHEDULE = 'GST rates in force from 22 September 2025';

export const GST_CATEGORIES = [
  // 0%
  { id: 'milk', name: 'Milk: fresh, pasteurised or UHT', hsn: '0401', rate: 0 },
  { id: 'salt', name: 'Salt', hsn: '2501', rate: 0 },
  { id: 'pulses-loose', name: 'Pulses (dal), loose', hsn: '0713', rate: 0 },
  { id: 'rice-loose', name: 'Rice, loose', hsn: '1006', rate: 0 },
  { id: 'atta-loose', name: 'Wheat flour (atta), loose', hsn: '1101', rate: 0 },
  { id: 'flour-other-loose', name: 'Other cereal and millet flours (ragi, jowar...), loose', hsn: '1102', rate: 0 },
  // 5%
  { id: 'pulses-packed', name: 'Pulses (dal), pre-packaged and labelled', hsn: '0713', rate: 5 },
  { id: 'rice-packed', name: 'Rice, pre-packaged and labelled', hsn: '1006', rate: 5 },
  { id: 'atta-packed', name: 'Wheat flour (atta), pre-packaged and labelled', hsn: '1101', rate: 5 },
  { id: 'flour-other-packed', name: 'Other cereal and millet flours (ragi, jowar...), pre-packaged and labelled', hsn: '1102', rate: 5 },
  { id: 'oil-groundnut', name: 'Groundnut oil', hsn: '1508', rate: 5 },
  { id: 'oil-sunflower', name: 'Sunflower oil', hsn: '1512', rate: 5 },
  { id: 'oil-coconut', name: 'Coconut oil', hsn: '1513', rate: 5 },
  { id: 'oil-mustard', name: 'Mustard oil', hsn: '1514', rate: 5 },
  { id: 'sugar', name: 'Sugar', hsn: '1701', rate: 5 },
  { id: 'tea', name: 'Tea, processed', hsn: '0902', rate: 5 },
  { id: 'coffee', name: 'Coffee, roasted or ground', hsn: '0901', rate: 5 },
  { id: 'coffee-instant', name: 'Instant coffee and coffee extracts', hsn: '2101', rate: 5 },
  { id: 'ghee-butter', name: 'Butter and ghee', hsn: '0405', rate: 5 },
  { id: 'cheese', name: 'Cheese and paneer', hsn: '0406', rate: 5 },
  { id: 'biscuits', name: 'Biscuits', hsn: '1905', rate: 5 },
  { id: 'soap', name: 'Toilet soap', hsn: '3401', rate: 5 },
  // 18%
  { id: 'detergent', name: 'Detergents and washing powder', hsn: '3402', rate: 18 },
  { id: 'standard', name: 'Other goods (standard rate)', hsn: '', rate: 18 },
];

// Goods not listed above are taxed at the standard rate.
export const DEFAULT_GST_CATEGORY = 'standard';

export function findGstCategory(id) {
  return GST_CATEGORIES.find((c) => c.id === id) || null;
}

export function formatRate(rate) {
  return `${rate}%`;
}

// "Biscuits · HSN 1905 · 5%", for drop-down lists.
export function gstCategoryLabel(c) {
  return [c.name, c.hsn ? `HSN ${c.hsn}` : null, formatRate(c.rate)].filter(Boolean).join(' · ');
}
