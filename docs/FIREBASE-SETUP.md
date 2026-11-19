# Connect Firebase later

No Firebase URL or private key is required to use the local retail workspace. Leave the cloud values blank until a separate retail project is ready. Do not reuse the hotel database or hosting environment when delivering this template to a different customer.

## Architecture

Browser / PWA -> same-origin /api/cloud -> Firebase Admin SDK -> Realtime Database.

Business records remain available in the authorized browser replica for offline transactions. After a successful reconnect, queued commands are validated, deduplicated and synchronized. Other authorized devices receive the shared shop's latest data. A pending or failed upload is not a completed backup.

## Prepare the retail project

1. Create a separate Firebase project and Realtime Database.
2. Use locked database rules for public clients. This app accesses Firebase through its server, rather than making the database publicly writable.
3. Generate a Firebase Admin service-account credential for the retail project and keep the JSON outside the repository. The Admin SDK runs in a privileged server environment. Follow [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup).
4. Deploy this template as a separate hosting project that supports its Node API function. The supplied Vercel configuration includes `api/cloud.ts`; static-file hosting alone will not execute that endpoint.

The project includes `firebase/database.rules.json`. Review and deploy rules to the correct retail Firebase project. Firebase rules control client access; the privileged server must also validate every authenticated operation. See [Realtime Database Security Rules](https://firebase.google.com/docs/database/security) and the [Admin Database introduction](https://firebase.google.com/docs/database/admin/start).

## Generate private environment values

On the trusted development PC, run:

```powershell
node scripts/create-cloud-config.mjs C:\Private\retail-service-account.json https://YOUR-RETAIL-DATABASE.firebaseio.com/
```

Use the exact database URL shown in Firebase; some regions use a `firebasedatabase.app` origin. The helper checks the URL and credential structure, generates a new staff PIN and writes private files to ignored `artifacts/cloud-config/<timestamp>/`. It does not print credentials.

Set these values in the retail hosting project's server environment. Also set the non-secret build flag `VITE_ENABLE_CLOUD=true`, then rebuild/redeploy. The flag enables automatic cloud discovery; it contains no Firebase credential.

| Variable | Value |
|---|---|
| FIREBASE_DATABASE_URL | Retail Realtime Database origin |
| FIREBASE_SERVICE_ACCOUNT_JSON | Private Admin service-account JSON |
| CLOUD_POS_PIN_HASH | Generated salted staff PIN hash |
| CLOUD_SESSION_SECRET | Generated independent session secret |
| CLOUD_ADMIN_PIN or CLOUD_ADMIN_PIN_HASH | Optional separate owner-only unlock credential |

Do not use `VITE_` prefixes for those values. Do not put credentials into source files, a public URL, browser localStorage, GitHub, a screenshot or a support message. The helper's PIN handover file is for the owner, not an environment variable. Rotate a credential if it is exposed.

## Connect and verify

1. Export an encrypted backup of the original retail device first.
   If moving from localhost to a different hosted address, that new origin cannot read the old browser database. First deploy the retail site with cloud discovery disabled, restore the encrypted backup on that address and sign in with its owner PIN. Then enable cloud discovery and complete the initial transfer from that prepared browser. Do not create a competing empty shop before migrating the original data.
2. Open the new HTTPS site and sign in with its generated staff PIN. Keep the original device open while its first transfer completes if migrating existing local data.
3. Confirm the cloud status reports successful contact and the pending transaction count clears. Do not create independent empty shops on several devices and assume they will automatically merge.
4. Open the same address on a second device, sign in, and check product/stock/customer totals.
5. On a test shop, create one online sale, verify it on device two, then disconnect device one and create an offline sale. Reconnect, wait for the queue to clear and verify the bill appears once with the correct stock and loan balance.
6. Test a fresh authorized browser after cloud synchronization to verify restore. Never erase the only copy of pending offline data to test recovery.

## Limits and recovery

Local-only changes made after the last successful sync cannot be recovered from the cloud if that device's site data is deleted or the device is lost. Browser persistence reduces automatic eviction when granted; it does not defeat deliberate data deletion or provide unlimited storage. Installing the PWA does not change that rule.

Keep independent encrypted exports as well as cloud records. Monitor the selected hosting/Firebase plans and their usage limits; this template does not guarantee unlimited free service.
