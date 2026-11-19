# Mr. Chicken House POS

Retail and wholesale counter sales and a separate Coconut workspace for Mr. Chicken House, No. 97 Kalawewa Road, Damunumulla, Galewela. Telephone 077 4903964 or 072 1723349.

## Open a workspace

Open the Shop POS and enter the Shop PIN. Use **Coconut workspace** to switch to coconut operations and enter the Coconut PIN. Each workspace has its own sign-in and device storage. Sign in online once on each device to prepare offline access.

The Shop POS includes weighed sales in grams or kilograms, value-to-weight entry, retail and wholesale rates, receipts, inventory, purchases, customer loans and repayments, and staff records.

The Coconut workspace includes estate purchases by size, husking and wages, sorting into grades, measured copra and oil batches, sales, expenses and day end. Entries saved while offline sync after reconnecting. A stock conflict keeps the local entry pending and shows the reason.

## Previous records

The first shared Shop POS opens with the previous product catalog, opening stock and outstanding customer loan balances. Previous bills and loan payment history can be downloaded using **Previous shop records**. They stay in the original Firebase collections.

Coconut opens with the previous coconut ledger. Its first new transaction initializes the separate Coconut cloud workspace. The original Firebase collections remain available for audit. Finish syncing sales and coconut entries on old devices before beginning the handover.

## Run locally

Use Node.js 24.14 or newer. Configure server-only settings in an ignored .env file using .env.example as a guide.

    npm ci
    npm run build
    npm start

Open http://127.0.0.1:4176/ when PORT is 4176. The default server port is 3001. The static preview can be opened at http://localhost:4175/ and supports independent device data.

## Deploy

The Vercel build serves both pages and the authenticated Firebase endpoints. Set FIREBASE_DATABASE_URL, FIREBASE_SERVICE_ACCOUNT_JSON, CLOUD_SESSION_SECRET, CLOUD_POS_PIN_HASH, and COCONUT_POS_PIN_HASH as server environment variables. Use CLOUD_TENANT_ID=chicken-shop. Set CLOUD_IMPORT_CHICKEN_LEGACY=true only for the existing Chicken Shop Firebase project. The two PIN hashes must correspond to different PINs.

    npm test
    npm run build
    npm run test:e2e
