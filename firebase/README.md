# Firebase backend setup

Hanuman uses Firebase Authentication (email/password), Cloud Firestore, Realtime Database, and Cloud Functions. Firebase web-app values are public client configuration; Firestore and Realtime Database rules protect the data. Never put Razorpay secrets, VAPID private keys, or the Coturn shared secret in a `VITE_` variable.

## Create and configure a Firebase project

1. Create a project in the [Firebase Console](https://console.firebase.google.com/) and register a Web app.
2. Enable **Authentication → Sign-in method → Email/Password** and customize the verification email template. Add local and deployed hostnames under **Authentication → Settings → Authorized domains**.
3. Create a **Cloud Firestore** database and a **Realtime Database** instance. Copy their project/database details.
4. Copy `.env.example` to `.env` and set the `VITE_FIREBASE_*` values from the Web app config. Use the Realtime Database URL shown in Firebase for `VITE_FIREBASE_DATABASE_URL`. Do not add a trailing path. For production GitHub Pages, also set `VITE_VAPID_PUBLIC_KEY` in `.env.production.example`; the Pages workflow intentionally omits the placeholder key.
5. Configure `VITE_RAZORPAY_KEY_ID` for emergency-alert extensions and the public `VITE_VAPID_PUBLIC_KEY` if enabling browser push. Marketplace subscriptions use the Razorpay server credentials and plan configured in Cloud Functions.
6. Install the Firebase CLI, sign in, and select the project:

   ```sh
   npm install --global firebase-tools
   firebase login
   firebase use --add
   ```

Cloud Functions deployment and secret management require a Firebase project on the Blaze plan.

7. Install and build the Cloud Functions:

   ```sh
   cd functions
   npm ci
   npm run build
   cd ..
   ```

8. Configure server-only secrets and deployment parameters:

   ```sh
   firebase functions:secrets:set RAZORPAY_KEY_ID
   firebase functions:secrets:set RAZORPAY_KEY_SECRET
   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
   firebase functions:secrets:set VAPID_PRIVATE_KEY
   firebase functions:secrets:set TURN_SHARED_SECRET
   ```

   In Razorpay Dashboard, create an active **INR 100 monthly plan** (period Monthly, interval 1). During Functions deployment, set `RAZORPAY_MONTHLY_PLAN_ID` to that plan ID. Functions verify the plan amount and cadence before creating subscriptions. Razorpay requires a finite cycle count, so subscriptions are created for 1200 monthly cycles (its documented 100-year maximum) and can be cancelled earlier by the user. Set the public `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, and comma-separated `TURN_URLS` parameters when prompted during deployment. Set `FIREBASE_DATABASE_URL` to the Realtime Database URL so the request-status trigger can mirror authorized call participants.

9. Deploy the database rules, indexes, Realtime Database rules, and functions:

   ```sh
   firebase deploy --only firestore,database,functions
   ```

   After deployment, configure a Razorpay webhook in Dashboard using the deployed `razorpaySubscriptionWebhook` Function URL and the same webhook secret. Subscribe to `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.paused`, and `subscription.resumed`. Test with Razorpay test keys and a test-mode ₹100 monthly plan before switching to live keys.

   To publish only access rules and indexes after a rules change:

   ```sh
   firebase deploy --only firestore:rules,firestore:indexes,database
   ```

10. Restart Vite after editing `.env`:

    ```sh
    npm run dev
    ```

## Data and access model

- `profiles/{uid}` contains the owner's private account fields. Only that authenticated user can read or write it.
- `publicProfiles/{uid}` contains only name, username, creation time, and optional avatar color.
- Help requests store a `connection_mode` of `virtual` or `in_person`; the mode is visible to helpers before they submit an offer. In-person requests require a broad `locality` (for example, Indiranagar); never put a home address or precise location in this public field. Emergency requests also require a user-entered area or landmark.
- Marketplace feeds and each request's offer list load in pages of 24. Feed pages retrieve accepted offers and the signed-in helper's own offer only; accepting an offer updates just that offer and its request, rather than scanning every competing offer. Deploy `firestore.indexes.json` with the rules for locality and helper-offer queries.
- `usernameClaims/{username}` reserves each normalized username for one Firebase user. Profile writes create/update the claim and profile atomically; the deployed Firestore rules require the matching claim. Username changes release the previous claim in the same transaction.
- `requests`, `offers`, and `ratings` hold marketplace documents. The client uses atomic Firestore transactions for offers, accepted-offer transitions, and ratings; deploy the provided rules to limit access.
- `featureSuggestions` accepts bounded suggestion text and is not readable by clients.
- Safety push endpoints and approximate locations are written by authenticated Cloud Functions. Client rules do not allow reading the subscriptions collection.
- Nearby SOS requires the VAPID public key in both the web app (`VITE_VAPID_PUBLIC_KEY`) and Functions (`VAPID_PUBLIC_KEY`), plus the matching `VAPID_PRIVATE_KEY` secret. The push worker is registered relative to the app base path, and notification links open the active SOS request.
- `payments` is server-only. Functions verify Razorpay order ownership, amount, INR currency, signature, and captured status before extending an emergency request.
- `marketplaceSubscriptions/{uid}` is written only by Cloud Functions. Each Firebase account requires its own ₹100/month Razorpay subscription to post requests, submit offers, or accept an offer. The webhook signature is verified before subscription status is updated; marketplace rules independently require an active paid-through period. Users can schedule cancellation at the end of their current billing cycle.
- The monthly subscription replaces marketplace posting fees and per-job platform commissions. It does not collect or split the requester's agreed payment to a helper; any job payment is settled separately by the participants. Emergency alert extensions remain a separate ₹25 one-time Razorpay checkout.
- Realtime Database `callSignals` carries ephemeral WebRTC signaling. The Firestore trigger writes participant access at `callAccess/{requestId}/{uid}`; Realtime Database rules use that map to allow signaling only for the requester and accepted helper.

Firestore automatically prompts for any composite index missing from the deployed index file; add only reviewed indexes to `firestore.indexes.json`.

## Existing backend data and accounts

Data is not copied automatically from a previous backend to Firebase. Export and migrate marketplace documents separately before retiring the old project. Firebase Auth accounts and passwords cannot be imported by this client app; users must create Firebase credentials or complete a trusted migration flow that verifies account ownership. Do not copy passwords or assign unverified email addresses to existing accounts.

## Local development

Without Firebase web configuration, the development app uses browser-local demo accounts and marketplace data. Local demo passwords are PBKDF2-hashed in browser storage. Cloud Functions, shared Firestore data, remote push delivery, payments, and calling require a configured Firebase project and deployed services.
