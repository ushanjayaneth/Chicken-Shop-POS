# Retail feature guide

| Area | Included behavior |
|---|---|
| Register | Barcode/name/SKU search, touch input, quantity edits, weighted goods, customer selection, counter sales without tables |
| Pricing | Purchase and selling prices, captured sale costs, fixed rupee item discounts and bill discounts |
| Wholesale | Register toggle, optional trade price per product, retail fallback, mode saved with drafts/held bills and confirmed receipts |
| Payments | Cash/change, card records, QR/bank records, Customer Loan, immediate part payment, later collections |
| Bills | Hold/resume, completed history, receipt reprint and authorized refunds |
| Catalog | Categories, availability, unique SKU/barcode, image links, camera/file photos, compressed uploads |
| Inventory | Linked product stock, unit quantities, per-product low-stock limits, stock adjustments and wastage reasons |
| Purchasing | Supplier directory, invoices, duplicate invoice protection, weighted costs and supplier payment ledger |
| Customers | Contact details, loan purchases, items, outstanding amount and installment history |
| Operations | Opening float, cash shift close/count variance, expenses and audit history |
| Staff & payroll | Employee profiles, attendance, advances, employee loans, partial repayments, salary deductions, monthly pay records, CSV and payslips |
| Reporting | Sales, costs/profit, collections, outstanding dues, income/expenses and CSV export |
| Devices | Responsive browser/PWA, keyboard shortcuts, font scale and receipt dimensions |
| Protection | Staff roles, optional cloud admin lock, encrypted backup export/import and explicit connection status |
| Optional cloud | Server-side Firebase credentials, shared-shop access, cloud recovery and offline transaction replay |

## Weighed goods

Use a weight/volume unit such as kg or litre, enter its per-unit price and sell a decimal quantity. Monetary totals are rounded to cents per line. Counted goods use whole quantities. Stock movements preserve their own units; entering 500 against kg means 500 kg, not 500 g. Convert grams to kilograms before entry (500 g = 0.500 kg).

## Profit and debt

A bill captures the cost used at its sale time so future purchase-price changes do not rewrite old margins. Customer Loan balances come from sale, collection and adjustment/refund entries. Collected income, sales/profit and outstanding receivables are different figures; use each report's label and date range.

## Retail and wholesale

Enter the normal selling price and, optionally, a Wholesale price in the product editor. At the register, choose Retail or Wholesale. Switching reprices the current unconfirmed cart; both modes use the same physical stock. A missing wholesale price uses the retail price and is labeled on the product card. Confirmed bills keep their captured prices even when the mode or product prices are later changed.

## Best-before dates

Each linked product stock row can have one optional best-before date. Inventory and Overview show stock dated within 30 days. This is a current-lot reminder, not a full batch/FIFO stock ledger. Inspect dated goods and record an authorized wastage or adjustment where needed.

## Scope of offline operation

Once the workspace and app files have been prepared, saved products, bills, stock and ordinary payments can be used offline. A first visit on a new device still needs access to the website and, for cloud shops, initial authorization. External photo URLs must have loaded successfully before their image can appear offline. Uploaded product photos are stored with the workspace.

An offline card/QR record does not mean the bank transaction has been authorized. Confirm it using the bank's terminal or payment application.

## Hardware boundaries

Barcode scanners that behave like a keyboard can enter codes directly. Receipt size/alignment is configurable. USB/Bluetooth permissions, printer drivers, a LAN bridge and browser support vary by hardware. Device detection and a test print do not prove every advanced printer command is supported. Keep browser print as the fallback.

## Template status

Firebase is optional and intentionally unconfigured in this copy. The application must report its actual connection state; no green cloud status is assumed merely because Wi-Fi is connected. Separate devices share data only after they use the same authorized cloud shop.

Some internal transaction field names retain compatibility with the original platform. Restaurant tables, kitchen routing and food production are not part of the retail navigation.

See [Staff and payroll](STAFF-AND-PAYROLL.md) for attendance, staff-account and salary workflows.
