# InventorySync

Multi-store stock sync with low-stock alerts for regional retail chains.

Everyone uses **one page** (`/`, `index.html`) and the same sign-in screen:

| Who | Signs in with | Sees |
|-----|---------------|------|
| A shop (Store Manager) | The **Shop ID and password** the admin created | Its own shop's stock, cart, Stop / Resume, Add product |
| Head office (Inventory Buyer) | A head-office **Shop ID and password** | All shops: Receive, Transfer, Reorder, Add product |
| The admin (you) | Open **`/admin`**: it shows **Admin sign in** with the Shop ID `admin` filled in; type the **admin passcode** | Everything head office sees, plus a **Shops & logins** view; switch with **Stock \| Shops & logins** in the navbar (the selected view is filled in, and it is remembered on refresh) |

Shops open `/` and see only **Shop sign in**, with no admin option; the Shops & logins code is
only loaded after the admin signs in. Bookmark `/admin` for yourself (signing in at `/` with the
Shop ID `admin` works too). Everyone can **Change password** from the navbar.

Two front ends share the same rules, storage and data:

| Build | Open | Stack |
|-------|------|-------|
| **Vanilla** (main) | `index.html` | HTML5, Bootstrap 5.3.8 (local `vendor/`), plain CSS, vanilla JS ES modules, `localStorage` / `sessionStorage` / `BroadcastChannel`. No build step. |
| **React** | `react-app/index.html` (built) or `react/` (source) | React 19.3.0 + Vite 8.3.4 + Bootstrap 5.3.8, importing `js/inventory.js`, `js/store.js`, `js/export.js`, `css/style.css` and `data/sample-data.json` from the vanilla build. |

Both use the same localStorage key, so a sale in a React tab shows up in a vanilla tab and the other way round.

**Live demo:** <https://utkarsh2730.github.io/InventorySync/>
· React version: <https://utkarsh2730.github.io/InventorySync/react-app/>
· Tests: <https://utkarsh2730.github.io/InventorySync/tests.html>
· Vercel: <https://inventory-sync-lovat.vercel.app>

> **Browser-only demo.** There is no server: stock, shops, shop logins and the admin passcode
> live in each browser's own storage. A shop login therefore works **only in the browser where
> the admin created it** (for testing, sign in as admin in one tab and as a shop in another tab of the same browser).
> Passwords and the passcode are stored only as salted PBKDF2 hashes (never as typed), but anyone with this browser's developer tools
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
6. Sign in as the admin with the Shop ID `admin` (see 1.5 for the first run).

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

### 1.5 First run: admin passcode and shop logins

1. Open **`/admin`** (e.g. <https://inventory-sync-lovat.vercel.app/admin>). It shows **Admin sign in**
   with the Shop ID `admin` filled in. The first time in a browser it explains that no passcode is
   saved yet and shows a second password box: choose the **admin passcode** (at least 8 characters),
   type it twice and click **Save password and sign in**. The passcode belongs to that browser only.
   From then on, open `/admin` and type the passcode.
2. Click **Shops & logins** in the navbar. In **Create shop login**, choose a shop (or
   **Head office** for the buyer's all-shops view). The name fills in by itself. Click
   **Generate Shop ID and password**.
3. The page shows the **Shop ID** (made from the shop name, e.g. `koramangala`) and a random
   **password** (e.g. `Xk7m-Pq4z-R9tw`) with Copy buttons. The password is shown **only once**
   and is never stored, only its salted hash. Give both to the shop.
4. The shop signs in on the same page (for testing: another tab of the same browser). The Shop
   ID is not case sensitive; the password is.
5. **The shop sets its own password:** until it does, it sees "You are using a password from
   head office" with a **Change password** button. **Change password** (navbar) asks for the
   current password and a new one twice (at least 8 characters, different from the current
   one). Other tabs signed in with the old password are signed out. The admin's **Password**
   column shows "From head office" or "Changed by shop".
6. In **Shop logins**: **Reset password** makes a new temporary password (shown once) and signs
   the shop out; **Disable** signs the shop out and blocks sign-in until you **Enable** it
   again. The table shows when each login last signed in.
7. **Add shop** creates a new shop with every product at 0. Then create a login for it.
8. **Reset data** (Shops & logins only) restores the sample stock and deletes added shops and all logins.
9. **Forgot password?** under the sign-in form: shops are told to ask head office for a reset.
   With the Shop ID `admin` typed, it offers to start over after typing `RESET`. Because there
   is no server to prove who is asking, that also **disables every shop login** (shops are
   signed out). Afterwards sign in as `admin` with a new passcode and enable each login again
   or reset its password. Stock, shops and products are kept.
10. `/admin`, `/admin/` and `/admin.html` all open the admin sign-in on the main page (`/#admin`).

**Can't sign in?**

| What you see | Fix |
|--------------|-----|
| `/admin` says "No admin passcode is saved in this browser yet" although you set one | You are in a different browser, profile or private window, or on the other site (Vercel and GitHub Pages keep separate data), or the site data was cleared. The passcode, shops and logins live in the browser and site where you created them. |
| "Wrong Shop ID or password" as admin and you forgot the passcode | Use **Forgot password?** with the Shop ID `admin` (see step 9). |
| A shop sees "Wrong Shop ID or password" | Check the Shop ID in **Shops & logins**. If the password is lost, use **Reset password** and give the shop the new one. |
| "This page cannot check passwords here" | Open the site over `https://` or from `localhost`/`127.0.0.1`. A phone opening Live Server through a `http://192.168…` address is not a secure page, so passwords cannot be protected. |
| A blank page, "did not start" or "could not start" | Press Ctrl+Shift+R (Cmd+Shift+R on a Mac) to reload without the cache. Since every script is now loaded with one version number (see below), this should not happen after updates. |

**Releasing a change:** `index.html` and `tests.html` load every script through an import map
with one version number (`?v=…`). Change that number (it appears in the import map and on the
`app.js` script tag) whenever you change a file in `js/` or `css/`, so browsers fetch the new set
instead of mixing old cached files with new ones.

---

## 2. Files

| File | Purpose |
|------|---------|
| `index.html` | Shop page: Shop ID and password sign-in, 4 summary cards, stock table, alert panel, cart (offcanvas on phones), modals for Receive, Transfer, Reorder level and Add product. |
| `admin.html`, `admin/index.html` | Make `/admin`, `/admin/` and `/admin.html` open the admin sign-in on the main page (`/#admin`). `vercel.json` does the same on Vercel. |
| `css/style.css` | Custom styles, focus outlines, scroll boxes, alignment, `@media print` stylesheet. Shared by both pages and the React build. |
| `js/inventory.js` | Pure rules, no DOM: `statusOf`, `can`, `checkout`, `transfer`, `receive`, `setReorderLevel`, `addProduct`, `setSelling`, `createAccount`, `resetAccountPassword`, `setAccountDisabled`, `signInAccount`, `userFromSession`, `suggestLoginId`, `addStore`, `filterRows`, plus read-only views. |
| `js/store.js` | `load`, `save`, `reset`, `readLatest`, `subscribe` (BroadcastChannel and `storage` event). |
| `js/export.js` | CSV export of the filtered rows (UTF-8 BOM, proper escaping, Blob download). |
| `js/ui.js` | Shared page helpers: safe element builder, toasts, banners, error boxes, dark mode. |
| `js/app.js` | Shop page: draws the screen and handles clicks. |
| `js/admin-auth.js` | The admin passcode (sign-in with Shop ID `admin`, first set-up, change, forget). |
| `js/admin-panel.js` | The admin's **Shops & logins** view: shops, Create shop login, Reset password / Disable / Enable, Reset data. Loaded only after the admin signs in. |
| `js/crypto.js` | Passwords: random password generator and salted PBKDF2-SHA-256 hashing (Web Crypto). Used by both pages and the React build. |
| `js/tests.js`, `tests.html` | Browser tests, no library. In-memory data only. |
| `data/sample-data.json` | 3 shops, 17 products (each with a brand; Toor Dal, Sunflower Oil and Assam Tea come from two brands), stock; no users or logins (the admin creates logins). |
| `vendor/bootstrap/` | Bootstrap 5.3.8 CSS and JS bundle. |
| `react/` | React + Vite source of the shop page: `src/App.jsx`, `src/useInventory.js` (wraps `store.js`), `src/components/`. |
| `react-app/` | Built React site (output of `npm run build`). It supports the same sign-in (including `admin`) and Change password; for Shops & logins the admin follows a link to the main page. |

### Data (one localStorage key: `inventorysync:v1`)

```json
{ "version": 1, "stores": [...], "products": [...],
  "stock": { "<storeId>": { "<sku>": { "qty": 3, "reorderLevel": 5 } } },
  "users": [], "accounts": [ { "loginId", "role", "storeId", "label", "salt", "hash", "iterations", "createdAt", "lastUsedAt", "disabled" } ],
  "log": [ { "time", "type", "storeId", "sku", "change", "userId" } ] }
```

Each product is `{ sku, name, brand, price }` (data version 2). A stock entry can also have
`"stopped": true` when that shop has stopped selling the item.

Other keys: `inventorysync:theme` (localStorage, dark/light choice), `inventorysync:admin`
(localStorage, the admin passcode's salt and PBKDF2 hash) and `inventorysync:shopSession` (sessionStorage:
the Shop ID and password hash of the login on that tab, never the password). A shop login can also have
`"tempPassword": true` while it still uses a password made by head office.

### Roles: `can(user, action, storeId)`

| Action (`can` name) | Shop (Store Manager login) | Head office (Inventory Buyer login) | Admin (`admin`) |
|---------------------|---------------------------|-------------------------------------|-------|
| `sell`              | own shop only | never | never |
| `receive`           | own shop only | any shop | any shop |
| `transfer`          | never | any shop | any shop |
| `setReorder`        | never | any shop | any shop |
| `addProduct`        | yes (chain-wide) | yes (chain-wide) | yes (chain-wide) |
| `setSelling` (Stop / Resume) | own shop only | never | never |
| `changeOwnPassword` | yes | yes | its passcode, through Change password |
| `manageAccounts`, `addStore` | never | never | yes |

`can()` is the first check in every write function in `inventory.js`. Hidden buttons are only a
convenience. Signing in is the one write with no signed-in user yet: a matching password hash
on an enabled login is itself the permission. A wrong Shop ID and a wrong password get the same
message, so nobody can find out which Shop IDs exist. A tab stays signed in only while its saved
Shop ID and hash still match, so **Reset password** or **Disable** signs it out at once.

### Brands and one language

Every product has a **brand**. The same item from different brands (for example Toor Dal 1 kg
from Tata Sampann and from 24 Mantra Organic) is a separate product with its own SKU, price and
stock. The brand shows under the product name in the table and cart, in alerts, dialogs and the
CSV, and Search matches it. Product names and brands are kept in **English only**: Add product
refuses other scripts, and data saved by older versions is upgraded on load (version 1 → 2:
brands added, non-English parts of names removed).

### Stopped selling

Each row of a shop's own items has a one-click **Stop** button. A stopped item is greyed out,
cannot be sold, and leaves that shop's alerts and Low/Out counts. **Stopped selling (N)** in the
toolbar lists all of them in one click; **Resume** puts an item back on sale.

---

## 3. Manual demo / test script

Sign in as `admin` (see 1.5), open **Shops & logins**, click **Reset data**, then create one login
for **Koramangala**, one for **Indiranagar** and one for **Head office**. Use them in other tabs of
the same browser.

| # | Steps | Expected |
|---|-------|----------|
| 1 | Shop page: sign in with the **Koramangala** Shop ID and password (try a wrong password first: "Wrong Shop ID or password"). | The Store filter starts on Koramangala: table, summary (3 Low, 1 Out) and alerts show Koramangala only. Rows have Add to cart, Receive and Stop. There is no admin option, view switch, user switcher or Reset button. A yellow reminder asks the shop to change the head-office password. |
| 2 | **R1.** *Toor Dal 1 kg* from **Tata Sampann** has 3. Add it to the cart twice, then **Checkout**. | "Sale recorded". Qty is now 1, status Low. The 24 Mantra Organic Toor Dal is a separate row and is not affected. |
| 3 | Add Toor Dal once, change the cart quantity to **2**, **Checkout**. | Refused: "only 1 in stock … cannot sell 2". Qty stays 1. |
| 4 | Put a valid line and an oversized line in the cart, **Checkout**. | Whole sale refused; neither quantity changes. |
| 5 | **R2.** Sign in with the **Head office** login. With Store = **All stores**, look at *All stores total*. | Equals the sum of that SKU across the shops. The column is hidden when one shop is selected. |
| 6 | **R4.** Keep the Koramangala tab open. Sell an item there. | The Head office tab updates qty, cards and alerts within 1 second, with no reload. |
| 7 | **R3.** Head office: *Cow Ghee* row for Indiranagar → **Transfer** 10 to Koramangala. | Indiranagar 25 → 15, Koramangala 0 → 10, all-stores total unchanged; the Koramangala Out alert clears. |
| 8 | **R5/R6.** Head office: **Reorder** on any row, set it above the quantity. | Status turns Low and the alert appears at once. Shops never see Transfer or Reorder; `tests.html` confirms the rules refuse them even if called directly. |
| 9 | **R6.** Head office: try to sell. | No cart is shown; `checkout` refuses a buyer (see `tests.html`). |
| 10 | Koramangala shop: **Add product** (e.g. `SALT-500G`). | The new product appears at 0 (Out) in every shop. |
| 11 | **Stop selling.** Koramangala: click **Stop** on any row, then **Stopped selling (1)**. | The item leaves the list and the alerts; the button lists it with a **Resume** button. Resume puts it back. |
| 12 | **Reset password / Disable.** Shops & logins: **Reset password** for `koramangala`, then **Disable** it, then **Enable** it. | Reset: the Koramangala tab is signed out at once; the old password fails and the new one works. Disable: signed out, and signing in says "disabled". Enable: signing in works again. |
| 13 | **Add shop.** Shops & logins: add "Whitefield", create a login for it, sign in with it. | Whitefield appears in the shops table and on the shop page with every product at 0. |
| 14 | **R7.** Refresh any tab. | Changes and sign-ins (per tab) are kept. Admin **Reset data** restores the sample and signs every shop out. |
| 15 | **R9.** Type `toor` in Search (name), then `saffola` (brand), then pick a Store and Status = Low. | Table narrows; "Showing N of M items" updates. Each brand of an item is its own row. |
| 16 | **R10.** With filters on, click **Export CSV**. Open it in Excel. | Same rows as the screen, with a Brand column; `₹` displays correctly; `Biscuits, Marie "Family Pack"` stays in one cell. |
| 17 | **Print / PDF** → Save as PDF. | Clean report: no navbar, buttons, filters or cart; header shows date and filters. |
| 18 | **R8.** DevTools device toolbar at **375 px**, then **1366 px**. | No sideways page scroll. On laptops the page fits the screen and the table, alerts and cart scroll inside their own boxes. |
| 19 | Toggle **Dark mode**, refresh. | Choice is remembered on both pages. |
| 20 | Keyboard only: Tab through both pages. | Every control is reachable with a visible focus outline. |
| 21 | **React.** Open `react-app/` and repeat steps 1–4, 11–12 and 22. | Same behaviour; the React tab and the shop page update each other. |
| 22 | **Change password.** Koramangala: **Change password**; try a wrong current password, then a good new one. Sign out and back in. | Wrong current: refused. Good: the reminder disappears; the old password stops working and the new one works; Shops & logins shows "Changed by shop". |
| 23 | **Admin view switch.** As `admin`, click **Stock** and **Shops & logins**. | One page: the stock dashboard (all shops, Receive/Transfer/Reorder/Add product) and the Shops & logins view; no second page or tab needed. |

---

## 4. Requirements traceability

| ID | Requirement | Where implemented | How to verify |
|----|-------------|-------------------|---------------|
| R1 | Never-negative sequential checkout | `checkout()` in `js/inventory.js`; `onCheckout()` + `runWrite()` (re-read, save once) in `js/app.js` | `tests.html` R1 checks; demo steps 2–4 |
| R2 | Per store per SKU, combined total | `buildRows()` (`chainTotal`) in `inventory.js`; table in `index.html` / `renderTable()` | Demo step 5; test “R2” |
| R3 | Transfers keep the total | `transfer()` in `inventory.js`; Transfer modal | Test “R3”; demo step 7 |
| R4 | Changes appear in other tabs within 1 s | `save()` posts on BroadcastChannel `inventorysync`; `subscribe()` (+ `storage` fallback) in `js/store.js` | Demo step 6 |
| R5 | Low/Out alerts update immediately | `statusOf()`, `alertsOf()`, `summarize()`; `renderAlerts()` / `renderCards()` | Test “Status …”, “R5”; demo step 8 |
| R6 | Role-based permissions | `can()` first in every write function; Shop ID + password sign-in (`signInAccount`, `userFromSession`, PBKDF2 hashes in `crypto.js`) on the shop page; admin signs in on the same page (Shop ID `admin`, PBKDF2 passcode in `admin-auth.js`); Change password (`changeOwnPassword`) | Tests “R6 …”, “Logins …”, “Change password …”, “Passwords …”; demo steps 1, 8, 9, 12, 22 |
| R7 | Persistence, sample data, reset | `load()`, `save()`, `reset()` in `store.js`; `data/sample-data.json`; Reset in Shops & logins | Demo step 14 |
| R8 | 1366 px and 375 px, no sideways scroll | Bootstrap grid (`col-12 col-sm-6 col-lg-3` cards, `col-lg-9` / `col-lg-3` columns), `table-responsive` scroll box, `offcanvas-lg` cart, `min-width:0` / `overflow-wrap` in `css/style.css` | Demo step 15 |
| R9 | Search and filters | `filterRows()` in `inventory.js`; input group + selects in `index.html` | Test “R9”; demo step 12 |
| R10 | CSV export, PDF via print | `js/export.js` (`rowsToCsv`, `downloadRowsAsCsv`); `@media print` in `style.css` | Tests “R10”; demo steps 13–14 |
| Stretch | React 19.3 + Vite 8.3 reusing `inventory.js` | `react/` (source), `react-app/` (build); imports `../js/inventory.js` unchanged | Demo step 18 |

---

## 5. Not built (Pilot and later phases)

Real server-side sign-in and per-chain data separation (R11; the shop logins here are browser-only), POS CSV import (R12), barcode scanning (R13),
WhatsApp alerts (R14), offline mode (R15), full audit log (R16), transfer suggestions, purchase
orders, batches, variants and forecasting. These need a hosted backend (Supabase), provider accounts
(WhatsApp Business) and API keys.
