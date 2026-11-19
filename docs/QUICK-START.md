# Start using DEMO MART

## 1. Open the workspace

Double-click `START-RETAIL-POS.cmd` and open http://localhost:4175 on the same computer. Development with automatic source-code reloads uses `npm run dev:web` at http://localhost:5173. The built preview does not need Firebase. The first load needs the local server or an HTTPS website; a prepared installed PWA can reopen offline after its app files and workspace have been saved.

Choose **Create your store**, enter an owner name and private 6-12 digit PIN, and select the sample grocery option to practice. This device workspace uses your chosen PIN. The optional branch-hub demo account uses **1234**. For real business, create a fresh workspace without sample data.

Keep using the same address and browser profile. `localhost`, `127.0.0.1`, different ports and a hosted website each have separate browser storage.

A phone/tablet should use a deployed HTTPS address. The ordinary browser works; installation is optional. Accessing a PC's development server through a plain HTTP LAN address does not provide the secure browser features required for protected device storage.

## 2. Add categories and products

Open Products or use Add category / Add product in Point of sale. Enter the product name, category, selling price and purchase cost. Assign a unique SKU and barcode if available. Use a photo URL, upload a file or take a photo on a compatible camera device.

Set up linked branch stock with its unit and opening quantity. Use pieces/packs/bottles for countable products and kilograms/litres for weighed goods. The selling price and purchase cost apply to one selected stock unit. For example, a kilogram price of Rs. 260 means 0.500 kg sells for Rs. 130 before discounts.

The low-stock threshold defaults to five when omitted. Products at or below their threshold receive an orange indicator. Keep tax and service charge at zero unless the shop actually charges them.

## 3. Sell and print

Scan a barcode or search the product, add it to the cart and tap the quantity to edit it. Add fixed rupee discounts to a line or the whole cart when authorized. Counter sales do not require a table.

Choose Charge order and record cash, card or QR/bank payment. Card and QR entries record payments received through your separate bank terminal or banking app; this POS does not itself charge a bank card. The committed bill remains in Sales history and can be reprinted even if the print dialog is canceled.

In Settings, choose receipt paper/content widths and margins in millimetres. Test alignment on the actual printer. Browser printing works offline once the device and printer are configured. Silent ESC/POS printing, drawer pulses and cutting require a compatible configured local bridge or printer; a normal web page cannot guarantee that every printer supports them.

## 4. Customer Loan and installments

Choose Customer Loan in the cart. Select a saved customer or record their name and phone. If part of the bill is paid immediately, enter that amount and its payment method; only the remainder becomes a loan.

Open Customers & dues to see the items purchased, transaction history and remaining balance. Record each later collection for the amount actually received. A partial collection reduces the balance by that amount; it does not clear the whole debt.

Reports distinguish earned sales/profit from collected income and outstanding receivables. Uncollected debt is not cash in the drawer.

## 5. Receive stock and pay suppliers

Create the supplier, receive an invoice against existing stock items and enter quantity and unit cost. The system adds quantities and calculates weighted average costs. Confirm the invoice number to prevent duplicate receiving.

Record payments against the supplier account and review the remaining payable. Keep actual bank/cash payment evidence alongside the recorded entry. Receiving goods and paying a supplier are separate actions.

## 6. Close the day and back up

Record operating expenses, review sales and dues, count actual drawer cash and close the shift. Download the required CSV reports.

In Settings > Device storage & backups, export a password-protected backup to a separate drive or folder. Store the backup password safely and verify a restore on a separate test browser before depending on it. Export backups regularly while cloud is not configured.

Offline changes remain local. Later cloud setup is described in [Firebase setup](FIREBASE-SETUP.md). A second device cannot see an independent local workspace until shared cloud access is configured.
