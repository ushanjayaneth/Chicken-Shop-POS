# Mr. Chicken House POS

A responsive point of sale for Chicken House and a separate Coconut Business workspace.

- Billing, weighted quantities, retail and wholesale prices, discounts, receipts, returns and exchange credits
- Stock receipts, low-stock alerts, barcode labels, product photos and recorded stock adjustments
- Customer loans with deposits and partial repayments
- Coconut purchases, processing yields, sales, worker payments and day-end reconciliation

## Run locally

Use Node.js 20 or later. Install dependencies with npm ci. Start the workspace with npm start and open http://localhost:4188.

For a disposable sample database, run node tests/fixture-server.mjs and open http://127.0.0.1:4189. This sample keeps test transactions in memory.

Run npm run build for syntax checks, npm test for data tests and npm run test:e2e for browser tests. Install Playwright Chromium with npx playwright install chromium if needed.

## Data and offline operation

Open the app online once to download your workspace and prepare the offline shell. The same URL works in a browser and as an installed app. Install from your browser menu if you want a home screen or desktop shortcut.

The app saves completed transactions and their pending uploads together in IndexedDB. The status dots show network and cloud status separately. On reconnect, pending transactions upload first and the app then loads current shared records. A cloud conflict keeps the pending change on the device for review.

Settings contains JSON backup export and restore. Restore replaces the selected workspace data and queues those records for the shared database. Keep a current export before restoring an older snapshot.

## Server and printing

The browser calls the same-origin /api/data/ endpoint. The Vercel API uses FIREBASE_DATABASE_URL when set. Use the environment variable for a separate workspace database. Protect production access at the deployment and database layers. The admin PIN controls features in the interface.

Receipt and label printing use the system print dialog or compatible browser-connected hardware. Install network printers in the operating system for system printing. Keyboard-style scanners send barcodes directly to the POS. Camera scanning requires browser permission.

Representative product photo sources are recorded in assets/images/sources.json. The font and bundled library licenses are included with the assets.
