# Reuse this template for another shop

## Keep each customer separate

Copy the source into a new folder or repository. Do not copy `node_modules`, `dist`, `data`, backups, private environment files, `.vercel`, `.git` or `artifacts` from an operating shop. Install dependencies with `npm ci`.

This copy uses its own retail IndexedDB names and storage preference key. Browser storage is also isolated by website origin. Use a separate deployment and Firebase project for every unrelated customer. A source folder copy alone does not separate two shops served from the same website origin.

## Brand the shop

Create the workspace with its business name, then set the receipt footer, currency/tax requirements and receipt dimensions. The receipt footer can hold the store address and telephone. Replace the app name/title in `index.html` and the PWA manifest settings in `vite.config.ts` when issuing a separately branded build. Replace app icons with appropriately sized assets.

Create genuine categories/products and verify barcode uniqueness. Select stock units before transactions begin. Set opening stock only after an actual stock count. Never turn demo quantities or sample transactions into live records by merely renaming the business.

## Configure roles and access

Create separate owner/cashier/storekeeper accounts as appropriate. Use private PINs. The demonstration PIN 1234 is public. The optional shared-cloud logo lock is an additional owner-only interface gate; it is not a replacement for device security and does not encrypt every locally stored business record.

## Reset or move data safely

For a new shop, use a fresh browser profile or a fresh origin and create an empty workspace. Before clearing an existing workspace, export and verify an encrypted backup, confirm pending cloud commands have finished and keep a copy outside that device. Clearing browser site data removes local records and credentials; reinstalling a PWA is not a backup operation.

Restore an existing shop only into its intended device/workspace. Do not merge unrelated shops by importing their backups into each other. Test an export/restore on a spare browser before handing over the system.

## Handover checks

- Correct business identity, receipt width, opening stock and product cost/selling prices.
- Barcode scan and a weighted sale with a fractional quantity.
- Cash change, card/QR records and Customer Loan with immediate part payment.
- Partial customer repayment and the remaining balance.
- Supplier receiving, weighted average cost and partial supplier payment.
- Offline reopen, offline sale/reprint, stock deduction and backup restore.
- If cloud is enabled, one transaction reaches the other device exactly once.
- Day-end count, expenses, reports, owner/cashier permissions and update prompt.

Hardware tests should use the shop's actual printer/scanner. Retain the test evidence and explain the difference between recorded payments, actual bank authorization, completed sync and pending local changes.
