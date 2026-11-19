# Mr. Chicken House POS

A responsive point of sale for Chicken House and a separate Coconut Business workspace.

- Billing, weighted quantities, retail and wholesale prices, discounts, receipts, returns and exchange credits
- Stock receipts, low-stock alerts, barcode labels, product photos and recorded stock adjustments
- Customer loans with deposits and partial repayments
- Coconut purchases, separate peeled-stock grades, processing yields, sales, worker payments and day-end reconciliation

## Run locally

Use Node.js 24. Install dependencies with npm ci. Start the workspace with npm start and open http://localhost:4188.

For a disposable sample database, run node tests/fixture-server.mjs and open http://127.0.0.1:4189. This sample keeps test transactions in memory.

Run npm run build to validate the app and prepare the public/ directory. Run npm test for data tests and npm run test:e2e for browser tests. Install Playwright Chromium with npx playwright install chromium if needed.

## Data and offline operation

Open the app online once to download your workspace and prepare the offline shell. The same URL works in a browser and as an installed app. Install from your browser menu if you want a home screen or desktop shortcut.

The app saves completed transactions and their pending uploads together in IndexedDB. The status dots show network and cloud status separately. On reconnect, pending transactions upload first and the app then loads current shared records. A cloud conflict keeps the pending change on the device for review.

Settings contains JSON backup export and restore. Restore replaces the selected workspace data and queues those records for the shared database. Keep a current export before restoring an older snapshot.

## Coconut stock flow

Raw large and small nuts can be sold directly or sent to husking. Sort peeled stock into Large, Small and Set aside for drying in Processing. Choose the peeled stock group when selling. A copra batch can consume nuts from one or more groups and adds its measured output in kilograms. Sell copra directly or mill part of it into oil and poonac.

## Server and printing

The browser calls the same-origin /api/data/ endpoint. The hosted app serves browser assets from public/ and runs the handlers in api/. The local Node.js server can serve the same workspace on a shop computer.

For shared cloud records, set the following server environment variables. For local development, use .env.local.

- FIREBASE_DATABASE_URL is the Realtime Database instance URL.
- FIREBASE_SERVICE_ACCOUNT_JSON is the JSON for a Google service account with access to that instance.
- POS_ACCESS_KEY is a random key of at least 24 characters. Keep it on the server. It signs device sessions and protects the stored PIN digest.

Keep the service account credentials in the server environment. The starter workspace PIN is 1234 on the shop PC at localhost. Set a new 6–12 digit Workspace PIN in Settings while online to enable browser access on other devices. Sign-in attempts are limited on the server. Existing devices keep their signed sessions for up to 30 days. New sign-ins use the updated PIN. Cached records stay available offline. The separate Admin PIN controls features in the app interface.

Without Firebase configuration, sales and other transactions stay on the current device. Use Settings to download a backup before moving to another computer. The browser treats each address and port as a different workspace.

Receipt and label printing use the system print dialog or compatible browser-connected hardware. Install network printers in the operating system for system printing. Keyboard-style scanners send barcodes directly to the POS. Camera scanning requires browser permission.

Representative product photo sources are recorded in assets/images/sources.json. The font and bundled library licenses are included with the assets.
