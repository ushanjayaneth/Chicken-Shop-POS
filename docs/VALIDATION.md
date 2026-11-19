# Template validation

Validated on 7 November 2026 using Node.js 24.14.1 and Chromium.

- Production build and TypeScript checks completed successfully.
- All **216** automated transaction, security, storage, media, backup, offline-sync and retail/payroll tests passed.
- Four browser workflows passed, including a focused rerun after correcting the test steps for bank-reference entry and first service-worker activation:
  - Retail/Wholesale repricing, hold/resume and the captured wholesale receipt.
  - A 390px phone layout: offline photo-product creation, cash/card/QR records, stock deduction and offline reopen without a repeated PIN prompt.
  - Offline customer downpayment, loan creation and a later partial collection preserving the remaining debt.
  - Offline employee attendance, advances, loans, part repayment, payroll recovery, payslip and CSV export.
- Staff-account and salary arithmetic was verified through device, SQLite hub and shared-cloud transaction handlers. Duplicate salary payments and excessive recoveries were rejected without partial writes.
- The local production preview was checked over HTTP, including its service-worker file. Original hotel-project files were left unchanged.

## Practical limits

Firebase is intentionally unconfigured. Shared-cloud tests use the real transaction handlers with isolated in-memory persistence; no live Firebase project or shop records were written. Verify the two-device online/offline transfer after configuring the customer's separate Firebase project.

Browser payment records do not themselves authorize a bank/card transaction. Actual printer/scanner drivers and paper alignment require a check with the shop's hardware. Payroll is a manually approved salary worksheet; statutory contributions/tax and automatic overtime calculations are outside this template.

The local browser database is not an external backup. Keep encrypted exports and verify completed cloud uploads before clearing site data.
