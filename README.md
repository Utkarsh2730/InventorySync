# InventorySync

Multi-store stock sync with low-stock alerts for regional retail chains.

There are two separate pages, and neither shows the other's sign-in:

| Page | Who | Signs in with |
|------|-----|---------------|
| **Shop page** `/` (`index.html`) | Each shop (Store Manager), or head office (Inventory Buyer) | An **invite code** created by the admin |
| **Admin page** `/admin.html` | Head-office admin | An **admin passcode** set on the first visit |

The shop page never mentions or links to the admin page; bookmark `/admin.html` yourself.

Two front ends share the same rules, storage and data:

| Build | Open | Stack |
|-------|------|-------|
| **Vanilla** (main) | `index.html` | HTML5, Bootstrap 5.3.8 (local `vendor/`), plain CSS, vanilla JS ES modules, `localStorage` / `sessionStorage` / `BroadcastChannel`. No build step. |
| **React** | `react-app/index.html` (built) or `react/` (source) | React 19.3.0 + Vite 8.3.4 + Bootstrap 5.3.8, importing `js/inventory.js`, `js/store.js`, `js/export.js`, `css/style.css` and `data/sample-data.json` from the vanilla build. |

Both use the same localStorage key, so a sale in a React tab shows up in a vanilla tab and the other way round.

**Live demo:** <https://utkarsh2730.github.io/InventorySync/>
· Admin: <https://utkarsh2730.github.io/InventorySync/admin.html>
· React version: <https://utkarsh2730.github.io/InventorySync/react-app/>
· Tests: <https://utkarsh2730.github.io/InventorySync/tests.html>
· Vercel: <https://inventory-sync-lovat.vercel.app>

> **Browser-only demo.** There is no server: stock, shops, invite codes and the admin passcode
> live in each browser's own storage. An invite code therefore works **only in the browser where
> the admin created it** (open the admin page and the shop page in two tabs of the same browser).
> The passcode is stored as a salted PBKDF2 hash, but anyone with this browser's developer tools
> can change stored data. Real shop accounts on their own phones need the pilot's server-side
> sign-in (R11, Supabase).

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
6. The admin page is at `http://127.0.0.1:5500/admin.html` (see 1.5 for the first run).

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

### 1.5 First run: admin passcode and invite codes

1. Open `/admin.html`. On the first visit in a browser it asks you to **set an admin passcode**
   (at least 8 characters). Keep it safe: it cannot be recovered. To start over, clear this
   site's data in the browser.
2. In **Create invite code**, choose a shop (or **Head office** for the buyer's all-shops view),
   give the code a name (e.g. "Indiranagar counter") and click **Generate code**. Copy it.
3. Open `/` in another tab of the same browser and enter the code. Codes are not case sensitive
   and the dashes are optional.
4. A code keeps working until you **Revoke** it on the admin page; the shop is signed out at once.
5. **Add shop** creates a new shop with every product at 0. Then create a code for it.
6. **Reset data** (admin page only) restores the sample stock and deletes added shops and all codes.

---

## 2. Files

| File | Purpose |
|------|---------|
| `index.html` | Shop page: invite-code sign-in, 4 summary cards, stock table, alert panel, cart (offcanvas on phones), modals for Receive, Transfer, Reorder level and Add product. |
| `admin.html` | Admin page: passcode sign-in, shops overview, Add shop, Create invite code, invite code list (Copy / Revoke), Reset data. |
| `css/style.css` | Custom styles, focus outlines, scroll boxes, alignment, `@media print` stylesheet. Shared by both pages and the React build. |
| `js/inventory.js` | Pure rules, no DOM: `statusOf`, `can`, `checkout`, `transfer`, `receive`, `setReorderLevel`, `addProduct`, `setSelling`, `createInvite`, `revokeInvite`, `signInWithCode`, `userFromInvite`, `addStore`, `filterRows`, plus read-only views. |
| `js/store.js` | `load`, `save`, `reset`, `readLatest`, `subscribe` (BroadcastChannel and `storage` event). |
| `js/export.js` | CSV export of the filtered rows (UTF-8 BOM, proper escaping, Blob download). |
| `js/ui.js` | Shared page helpers: safe element builder, toasts, banners, error boxes, dark mode. |
| `js/app.js` | Shop page: draws the screen and handles clicks. |
| `js/admin.js` | Admin page: passcode (PBKDF2), random invite codes, shops and codes. |
| `js/tests.js`, `tests.html` | Browser tests, no library. In-memory data only. |
| `data/sample-data.json` | 3 shops, 14 products, stock; no users or invite codes (the admin creates codes). |
| `vendor/bootstrap/` | Bootstrap 5.3.8 CSS and JS bundle. |
| `react/` | React + Vite source of the shop page: `src/App.jsx`, `src/useInventory.js` (wraps `store.js`), `src/components/`. |
| `react-app/` | Built React site (output of `npm run build`). The admin page is the vanilla `admin.html` for both. |

### Data (one localStorage key: `inventorysync:v1`)

```json
{ "version": 1, "stores": [...], "products": [...],
  "stock": { "<storeId>": { "<sku>": { "qty": 3, "reorderLevel": 5 } } },
  "users": [], "invites": [ { "code", "role", "storeId", "label", "createdAt", "lastUsedAt", "revoked" } ],
  "log": [ { "time", "type", "storeId", "sku", "change", "userId" } ] }
```

A stock entry can also have `"stopped": true` when that shop has stopped selling the item.

Other keys: `inventorysync:theme` (localStorage, dark/light choice), `inventorysync:admin`
(localStorage, the admin passcode's salt and PBKDF2 hash), `inventorysync:inviteCode` and
`inventorysync:adminSession` (sessionStorage, who is signed in on that tab).

### Roles: `can(user, action, storeId)`

| Action (`can` name) | Shop (Store Manager code) | Head office (Inventory Buyer code) | Admin |
|---------------------|---------------------------|-------------------------------------|-------|
| `sell`              | own shop only | never | never |
| `receive`           | own shop only | any shop | never |
| `transfer`          | never | any shop | never |
| `setReorder`        | never | any shop | never |
| `addProduct`        | yes (chain-wide) | yes (chain-wide) | never |
| `setSelling` (Stop / Resume) | own shop only | never | never |
| `manageInvites`, `addStore` | never | never | yes |

`can()` is the first check in every write function in `inventory.js`. Hidden buttons are only a
convenience. Signing in with a code is the one write with no signed-in user yet: a valid,
unrevoked code is itself the permission.

### Stopped selling

Each row of a shop's own items has a one-click **Stop** button. A stopped item is greyed out,
cannot be sold, and leaves that shop's alerts and Low/Out counts. **Stopped selling (N)** in the
toolbar lists all of them in one click; **Resume** puts an item back on sale.

---

## 3. Manual demo / test script

Start on the admin page: **Reset data**, then create one code for **Koramangala**, one for
**Indiranagar** and one for **Head office** (see 1.5). Use them on the shop page in other tabs of
the same browser.

| # | Steps | Expected |
|---|-------|----------|
| 1 | Shop page: sign in with the **Koramangala** code. | The Store filter starts on Koramangala: table, summary (3 Low, 1 Out) and alerts show Koramangala only. Rows have Add to cart, Receive and Stop. There is no admin sign-in, user switcher or Reset button. |
| 2 | **R1.** *Toor Dal 1 kg* has 3. Add it to the cart twice, then **Checkout**. | "Sale recorded". Qty is now 1, status Low. |
| 3 | Add Toor Dal once, change the cart quantity to **2**, **Checkout**. | Refused: "only 1 in stock … cannot sell 2". Qty stays 1. |
| 4 | Put a valid line and an oversized line in the cart, **Checkout**. | Whole sale refused; neither quantity changes. |
| 5 | **R2.** Sign in with the **Head office** code. With Store = **All stores**, look at *All stores total*. | Equals the sum of that SKU across the shops. The column is hidden when one shop is selected. |
| 6 | **R4.** Keep the Koramangala tab open. Sell an item there. | The Head office tab updates qty, cards and alerts within 1 second, with no reload. |
| 7 | **R3.** Head office: *Cow Ghee* row for Indiranagar → **Transfer** 10 to Koramangala. | Indiranagar 25 → 15, Koramangala 0 → 10, all-stores total unchanged; the Koramangala Out alert clears. |
| 8 | **R5/R6.** Head office: **Reorder** on any row, set it above the quantity. | Status turns Low and the alert appears at once. Shops never see Transfer or Reorder; `tests.html` confirms the rules refuse them even if called directly. |
| 9 | **R6.** Head office: try to sell. | No cart is shown; `checkout` refuses a buyer (see `tests.html`). |
| 10 | Koramangala shop: **Add product** (e.g. `SALT-500G`). | The new product appears at 0 (Out) in every shop. |
| 11 | **Stop selling.** Koramangala: click **Stop** on any row, then **Stopped selling (1)**. | The item leaves the list and the alerts; the button lists it with a **Resume** button. Resume puts it back. |
| 12 | **Revoke.** Admin page: **Revoke** the Koramangala code. | The Koramangala tab is signed out at once ("no longer active"); the code no longer signs in. |
| 13 | **Add shop.** Admin page: add "Whitefield", create a code for it, sign in with it. | Whitefield appears in the shops table and on the shop page with every product at 0. |
| 14 | **R7.** Refresh any tab. | Changes and sign-ins (per tab) are kept. Admin **Reset data** restores the sample and signs every shop out. |
| 15 | **R9.** Type `ghee` in Search, then pick a Store and Status = Low. | Table narrows; "Showing N of M items" updates. |
| 16 | **R10.** With filters on, click **Export CSV**. Open it in Excel. | Same rows as the screen; `₹`, `बासमती`, `ರಾಗಿ` display correctly; `Biscuits, Marie "Family Pack"` stays in one cell. |
| 17 | **Print / PDF** → Save as PDF. | Clean report: no navbar, buttons, filters or cart; header shows date and filters. |
| 18 | **R8.** DevTools device toolbar at **375 px**, then **1366 px**. | No sideways page scroll. On laptops the page fits the screen and the table, alerts and cart scroll inside their own boxes. |
| 19 | Toggle **Dark mode**, refresh. | Choice is remembered on both pages. |
| 20 | Keyboard only: Tab through both pages. | Every control is reachable with a visible focus outline. |
| 21 | **React.** Open `react-app/` and repeat steps 1–4 and 11–12. | Same behaviour; the React tab and the shop page update each other. |

---

## 4. Requirements traceability

| ID | Requirement | Where implemented | How to verify |
|----|-------------|-------------------|---------------|
| R1 | Never-negative sequential checkout | `checkout()` in `js/inventory.js`; `onCheckout()` + `runWrite()` (re-read, save once) in `js/app.js` | `tests.html` R1 checks; demo steps 2–4 |
| R2 | Per store per SKU, combined total | `buildRows()` (`chainTotal`) in `inventory.js`; table in `index.html` / `renderTable()` | Demo step 5; test “R2” |
| R3 | Transfers keep the total | `transfer()` in `inventory.js`; Transfer modal | Test “R3”; demo step 7 |
| R4 | Changes appear in other tabs within 1 s | `save()` posts on BroadcastChannel `inventorysync`; `subscribe()` (+ `storage` fallback) in `js/store.js` | Demo step 6 |
| R5 | Low/Out alerts update immediately | `statusOf()`, `alertsOf()`, `summarize()`; `renderAlerts()` / `renderCards()` | Test “Status …”, “R5”; demo step 8 |
| R6 | Role-based permissions | `can()` first in every write function; invite-code sign-in (`signInWithCode`, `userFromInvite`) on the shop page; separate admin page with a PBKDF2 passcode | Tests “R6 …”, “Invites …”; demo steps 1, 8, 9, 12 |
| R7 | Persistence, sample data, reset | `load()`, `save()`, `reset()` in `store.js`; `data/sample-data.json`; Reset on the admin page | Demo step 14 |
| R8 | 1366 px and 375 px, no sideways scroll | Bootstrap grid (`col-12 col-sm-6 col-lg-3` cards, `col-lg-9` / `col-lg-3` columns), `table-responsive` scroll box, `offcanvas-lg` cart, `min-width:0` / `overflow-wrap` in `css/style.css` | Demo step 15 |
| R9 | Search and filters | `filterRows()` in `inventory.js`; input group + selects in `index.html` | Test “R9”; demo step 12 |
| R10 | CSV export, PDF via print | `js/export.js` (`rowsToCsv`, `downloadRowsAsCsv`); `@media print` in `style.css` | Tests “R10”; demo steps 13–14 |
| Stretch | React 19.3 + Vite 8.3 reusing `inventory.js` | `react/` (source), `react-app/` (build); imports `../js/inventory.js` unchanged | Demo step 18 |

---

## 5. Not built (Pilot and later phases)

Real server-side sign-in and per-chain data separation (R11; the invite codes here are browser-only), POS CSV import (R12), barcode scanning (R13),
WhatsApp alerts (R14), offline mode (R15), full audit log (R16), transfer suggestions, purchase
orders, batches, variants and forecasting. These need a hosted backend (Supabase), provider accounts
(WhatsApp Business) and API keys.
