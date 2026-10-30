BOUHAJ Google Sheets Integration (0.1.1)

ONE-TIME SETUP (5 minutes)
1. Open https://script.google.com and create a New project.
2. Replace the content of Code.gs with the Code.gs from this folder.
   (Optional: Project Settings > "Show appsscript.json" and paste appsscript.json too.)
3. Choose the function `setup` in the toolbar and press Run. Authorize Google when asked.
   This creates the spreadsheet "BOUHAJ Orders" with an "Orders" sheet (see View > Logs for its link).
4. Deploy > New deployment > type: Web app.
   Execute as: Me.   Who has access: Anyone.
5. Copy the Web app URL (it ends with /exec).
6. In BOUHAJ: open the project > "Google Sheets" tab > paste the URL > Save & Generate.
7. Test: open the generated page, submit one order, check the "Orders" sheet.

IMPORTANT
- After editing Code.gs later you MUST create a NEW deployment version (Deploy > Manage deployments > Edit > Version: New version). The /exec URL stays the same.
- Order ids are de-duplicated, so a retried order never creates two rows.
- The hidden "website" field is a honeypot against bots.
- Never put Google credentials or service-account keys in the landing page.

OPTIONAL: INVENTORY (new)
- Run `setupInventory` once: creates the "Inventory" sheet (inventory_key, stock, label). Keys look like `productId:variantId` (or `productId:-` without variants).
- BOUHAJ generates `Inventory-seed.gs` from the stock you typed in the editor; run `seedInventory` once. It only ADDS missing rows and never overwrites live stock.
- With an Inventory row present, every order is checked and decremented under a script lock; sold-out orders get `OUT_OF_STOCK`. Without a row the key is "untracked". Delete the sheet to stop tracking.
- `GET <url>?action=stock` returns only valid keys with counts capped at 20 (no personal data).
- Existing "Orders" sheets are upgraded append-only (6 new columns at the end). Create a NEW deployment version after updating Code.gs.
