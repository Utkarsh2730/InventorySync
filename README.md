# InventorySync

Multi-store stock sync with low-stock alerts for regional retail chains.
Two roles: **Store Manager** (sells and receives in their own store) and
**Inventory Buyer** (receives, transfers, sets reorder levels, adds products; cannot sell).

Two front ends share the same rules, storage and data:

| Build | Open | Stack |
|-------|------|-------|
| **Vanilla** (main) | `index.html` | HTML5, Bootstrap 5.3.8 (local `vendor/`), plain CSS, vanilla JS ES modules, `localStorage` / `sessionStorage` / `BroadcastChannel`. No build step. |
| **React** | `react-app/index.html` (built) or `react/` (source) | React 19.3.0 + Vite 8.3.4 + Bootstrap 5.3.8, importing `js/inventory.js`, `js/store.js`, `js/export.js`, `css/style.css` and `data/sample-data.json` from the vanilla build. |

Both use the same localStorage key, so a sale in a React tab shows up in a vanilla tab and the other way round.

**Live demo:** <https://utkarsh2730.github.io/InventorySync/>
· React version: <https://utkarsh2730.github.io/InventorySync/react-app/>
· Tests: <https://utkarsh2730.github.io/InventorySync/tests.html>

> Sign-in is **simulated**: you pick one of three sample users. All data lives in your own browser.

---

## 1. Setup

### 1.1 Bootstrap 5.3.8

The two files are **already in `vendor/bootstrap/`** (copied from the `bootstrap@5.3.8` npm package,
with the source-map comment removed).
If you ever need to replace them:

1. Download **`bootstrap-5.3.8-dist.zip`** from the official release page:
   <https://github.com/twbs/bootstrap/releases/tag/v5.3.8>
   (or the “Download” button on <https://getbootstrap.com/docs/5.3/getting-started/download/>).
2. Unzip it and copy exactly these two files:

   | From the zip                       | To this project                               |
   |------------------------------------|-----------------------------------------------|
   | `css/bootstrap.min.css`            | `vendor/bootstrap/css/bootstrap.min.css`      |
   | `js/bootstrap.bundle.min.js`       | `vendor/bootstrap/js/bootstrap.bundle.min.js` |

   Use the **bundle** JS (it includes Popper). Then delete the last line of each file (the
   `sourceMappingURL` comment): the `.map` files are not shipped, and Vercel blocks them anyway,
   so without this DevTools reports missing source maps.

If the files are missing, the app shows a red banner saying so. The rules, storage and sync still
work, but the layout, dialogs and the phone cart panel need Bootstrap.

### 1.2 Run locally

ES modules do not load from `file://`, so use a local web server:

1. Open the `inventorysync` folder in VS Code.
2. Install the **Live Server** extension (Ritwick Dey).
3. Right-click `index.html` → **Open with Live Server**. It opens at `http://127.0.0.1:5500/index.html`
   (or `localhost:5500`).
4. Open `http://127.0.0.1:5500/tests.html` to run the critical-path checks. Every line should say PASS.
5. The built React version is at `http://127.0.0.1:5500/react-app/`.

### 1.3 React version (Node.js 20.19+ or 22.12+)

```bash
cd react
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`. `vite.config.js` allows it to read the parent folder,
because the React app imports the vanilla rules file unchanged.

To rebuild the static React site into `react-app/` (committed and served by GitHub Pages):

```bash
npm run build
```

The React app draws modals, the offcanvas cart, toasts and the navbar menu with React state
and Bootstrap's CSS classes, so it does not need Bootstrap's JavaScript.

### 1.4 Deploy to GitHub Pages

1. Create a GitHub repository, for example `inventorysync`.
2. In the `inventorysync` folder:
   ```bash
   git init
   git add .
   git commit -m "InventorySync"
   git branch -M main
   git remote add origin https://github.com/<your-user>/inventorysync.git
   git push -u origin main
   ```
   Make sure the two Bootstrap files in `vendor/` and the built `react-app/` folder are committed.
   `.gitignore` already leaves out `react/node_modules/`.
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`, then **Save**.
4. After a minute the site is live at `https://<your-user>.github.io/inventorysync/`
   and the React version at `https://<your-user>.github.io/inventorysync/react-app/`.
   Put that link at the top of this README.

All paths in the app are relative, so it works from the `/inventorysync/` sub-path.

---

## 2. Files

| File | Purpose |
|------|---------|
| `index.html` | The single page: navbar with user switcher, sign-in screen, 4 summary cards, stock table, alert panel, cart (offcanvas on phones), modals for Receive, Transfer, Reorder level and Add product. |
| `css/style.css` | Custom styles, focus outlines, no-sideways-scroll rules, `@media print` stylesheet. |
| `js/inventory.js` | Pure rules, no DOM: `statusOf`, `can`, `checkout`, `transfer`, `receive`, `setReorderLevel`, `addProduct`, `filterRows`, plus read-only views. |
| `js/store.js` | `load`, `save`, `reset`, `readLatest`, `subscribe` (BroadcastChannel and `storage` event). |
| `js/export.js` | CSV export of the filtered rows (UTF-8 BOM, proper escaping, Blob download). |
| `js/app.js` | Draws the screen and handles clicks. |
| `js/tests.js`, `tests.html` | Browser tests, no library. In-memory data only. |
| `data/sample-data.json` | 3 stores, 14 products, stock, 3 users. |
| `vendor/bootstrap/` | Bootstrap 5.3.8 CSS and JS bundle. |
| `react/` | React + Vite source: `src/App.jsx`, `src/useInventory.js` (wraps `store.js`), `src/components/` (Dashboard, Cart, Dialogs, Modal). |
| `react-app/` | Built React site (output of `npm run build`). |

### Data (one localStorage key: `inventorysync:v1`)

```json
{ "version": 1, "stores": [...], "products": [...],
  "stock": { "<storeId>": { "<sku>": { "qty": 3, "reorderLevel": 5 } } },
  "users": [...], "log": [ { "time", "type", "storeId", "sku", "change", "userId" } ] }
```

Other keys: `inventorysync:theme` (localStorage, dark/light choice) and `inventorysync:userId`
(sessionStorage, the signed-in user for that tab).

### Roles: `can(user, action, storeId)`

| Action (`can` name) | Store Manager | Inventory Buyer |
|---------------------|---------------|-----------------|
| `sell`              | own store only | never |
| `receive`           | own store only | any store |
| `transfer`          | never | any store |
| `setReorder`        | never | any store |
| `addProduct`        | never | yes (chain-wide) |

`can()` is the first check in every write function in `inventory.js`. Hidden buttons are only a convenience.

### Sample users

| User | Role | Store |
|------|------|-------|
| Asha Rao | Store Manager | Koramangala |
| Meena Iyer | Store Manager | Indiranagar |
| Ravi Kumar | Inventory Buyer | all stores |

---

## 3. Manual demo / test script (R1–R10)

Start with **Reset data** so you begin from the sample.

| # | Steps | Expected |
|---|-------|----------|
| 1 | Open the app, sign in as **Asha Rao**. | The Store filter starts on **Koramangala**: the table, the summary (14 products, 3 Low, 1 Out) and the alerts show Koramangala only. Rows have Add to cart and Receive. Pick **All stores** to see every branch (9 Low, 4 Out). |
| 2 | **R1.** Koramangala, *Toor Dal 1 kg* has 3. Add it to the cart twice, then **Checkout**. | “Sale recorded”. Qty is now 1, status Low. |
| 3 | Add Toor Dal once, change the cart quantity to **2**, **Checkout**. | Refused: “only 1 in stock … cannot sell 2”. Qty stays 1. |
| 4 | Put a valid line and an oversized line in the cart, **Checkout**. | Whole sale refused; neither quantity changes. |
| 5 | **R2.** Set Store to **All stores** and look at the *All stores total* column. | Equals the sum of that SKU across the three stores. The column is hidden when one store is selected. |
| 6 | **R4.** Open a second tab at the same URL, sign in as **Ravi Kumar**. Sell an item in tab 1. | Tab 2 updates qty, cards and alerts within 1 second, with no reload. |
| 7 | **R3.** As Ravi, *Cow Ghee* row for Indiranagar → **Transfer** 10 to Koramangala. | Indiranagar 25 → 15, Koramangala 0 → 10, all-stores total unchanged; the Koramangala Out alert clears. |
| 8 | **R5/R6.** As Ravi, **Reorder level** on any row, set it above the quantity. | Status turns Low and the alert appears at once. Asha never sees Transfer or Reorder buttons; the rule tests in `tests.html` confirm `transfer`/`setReorder` are refused for managers even if called directly. |
| 9 | **R6.** As Ravi, try to sell. | No cart is shown; `checkout` refuses a Buyer (see `tests.html`). |
| 10 | As Ravi, **Receive** 10 at any store, and **Add product** (e.g. `SALT-500G`). | Stock goes up; the new product appears at 0 (Out) in every store. |
| 11 | **R7.** Refresh the page. | All changes are still there. **Reset data** → confirm → sample values return. |
| 12 | **R9.** Type `ghee` in Search, then pick Store = Jayanagar, Status = Low. | Table narrows to matching rows; “Showing N of 42” updates. |
| 13 | **R10.** With filters on, click **Export CSV**. Open the file in Excel. | Same rows as the screen; `₹` and `बासमती` / `ರಾಗಿ` display correctly; `Biscuits, Marie "Family Pack"` stays in one cell. |
| 14 | **Print / PDF** → Save as PDF. | Clean report: no navbar, buttons, filters or cart; header shows date and filters. |
| 15 | **R8.** DevTools → device toolbar → **375 px** wide, then **1366 px**. | No sideways page scroll. Cards stack in one column at 375 px; the table scrolls inside its own box; the Cart button opens the offcanvas cart. Also try on a real phone. |
| 16 | Toggle **Dark mode**, refresh. | Choice is remembered. Without a saved choice, the OS setting is followed. |
| 17 | Keyboard only: Tab through the page. | Every control is reachable with a visible focus outline; the skip link appears first. |
| 18 | **React.** Open `react-app/` in one tab and `index.html` in another. Repeat steps 2–8 in the React tab. | Same behaviour and messages; each tab updates the other within 1 second. In React dialogs, focus starts in the first field, Tab stays inside, Escape closes. |

---

## 4. Requirements traceability

| ID | Requirement | Where implemented | How to verify |
|----|-------------|-------------------|---------------|
| R1 | Never-negative sequential checkout | `checkout()` in `js/inventory.js`; `onCheckout()` + `runWrite()` (re-read, save once) in `js/app.js` | `tests.html` R1 checks; demo steps 2–4 |
| R2 | Per store per SKU, combined total | `buildRows()` (`chainTotal`) in `inventory.js`; table in `index.html` / `renderTable()` | Demo step 5; test “R2” |
| R3 | Transfers keep the total | `transfer()` in `inventory.js`; Transfer modal | Test “R3”; demo step 7 |
| R4 | Changes appear in other tabs within 1 s | `save()` posts on BroadcastChannel `inventorysync`; `subscribe()` (+ `storage` fallback) in `js/store.js` | Demo step 6 |
| R5 | Low/Out alerts update immediately | `statusOf()`, `alertsOf()`, `summarize()`; `renderAlerts()` / `renderCards()` | Test “Status …”, “R5”; demo step 8 |
| R6 | Role-based permissions | `can()` first in every write function; sign-in in `app.js` (sessionStorage) | Tests “R6 …”; demo steps 1, 8, 9 |
| R7 | Persistence, sample data, reset | `load()`, `save()`, `reset()` in `store.js`; `data/sample-data.json` | Demo step 11 |
| R8 | 1366 px and 375 px, no sideways scroll | Bootstrap grid (`col-12 col-sm-6 col-xl-3`), `table-responsive`, `offcanvas-lg` cart, `min-width:0` / `overflow-wrap` in `css/style.css` | Demo step 15 |
| R9 | Search and filters | `filterRows()` in `inventory.js`; input group + selects in `index.html` | Test “R9”; demo step 12 |
| R10 | CSV export, PDF via print | `js/export.js` (`rowsToCsv`, `downloadRowsAsCsv`); `@media print` in `style.css` | Tests “R10”; demo steps 13–14 |
| Stretch | React 19.3 + Vite 8.3 reusing `inventory.js` | `react/` (source), `react-app/` (build); imports `../js/inventory.js` unchanged | Demo step 18 |

---

## 5. Not built (Pilot and later phases)

Real sign-in and per-chain data separation (R11), POS CSV import (R12), barcode scanning (R13),
WhatsApp alerts (R14), offline mode (R15), full audit log (R16), transfer suggestions, purchase
orders, batches, variants and forecasting. These need a hosted backend (Supabase), provider accounts
(WhatsApp Business) and API keys.
