# Rangana Communication POS (RCM POS)

RCM POS is an offline-first, progressive web app (PWA) designed for retail shops. It works 100% offline using IndexedDB, and automatically synchronizes with a remote Firebase Realtime Database when an active internet connection is available.

## Key Features

- **Offline-First Resilience**: All sales, inventory, category edits, and loan transactions are saved locally in IndexedDB instantly. The system is functional without internet.
- **Background Sync Engine**: Modifications are queued locally and automatically uploaded to the remote database in a FIFO (First-In, First-Out) queue when online.
- **Automatic Hydration**: Pulls remote database changes on startup/reconnect to keep all client devices in sync.
- **Secure Startup Login Screen**: Protects the system from unauthorized access. The login PIN pad is verified against the cached configuration in IndexedDB, meaning it works 100% offline even if the system is closed and reopened.
- **Secure API Gateway (Node.js)**: Requests are proxied via serverless Node.js endpoints (`/api/data/*`) on Vercel to securely tunnel data to Firebase Realtime Database, protecting database credentials from frontend exposure.

---

## Technical Architecture

### 1. Frontend Sync Engine
The frontend uses two IndexedDB stores (`RanganaCommPOS_DB`):
1. `cache`: Stores the full snapshot of remote data (categories, items, sales, loans, settings).
2. `queue`: A transaction queue storing offline modifications (`set`, `patch`, `del`) that need to be synced.

When online:
- The `Sync.flush()` task runs to process the `queue` sequentially.
- The `Sync.pull()` task runs to download the latest state from the database and hydrate the local cache.

### 2. Node.js Backend Proxy
Instead of calling Firebase directly from the browser, all data syncs go through `/api/data/*`.
On Vercel, this is handled by `api/data.js`, which proxies the request to `https://chicken-shop-2d7b5-default-rtdb.firebaseio.com/` using server-side fetching.

---

## Configuration

### API Server URL
By default, the POS communicates with the relative `/api` path (running as Vercel serverless functions).
If you want to run a custom local backend:
1. Open the POS app.
2. Go to the **Settings** modal (Gear icon ⚙️ in top right).
3. Under **API Server URL**, enter your local server URL (e.g. `http://localhost:8080` or `http://192.168.1.100:3000`).
4. Click **Save Settings**. The frontend will automatically route all sync operations through your custom URL.
5. Leave this field blank to use Vercel default serverless functions.