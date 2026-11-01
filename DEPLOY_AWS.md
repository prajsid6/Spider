# Spider — AWS deployment

Spider's static frontend can be hosted on AWS. Firebase provides email/password authentication, Cloud Firestore, Realtime Database, and Cloud Functions.

## Configure Firebase first

Follow [`firebase/README.md`](./firebase/README.md) to create the Firebase project, enable Authentication, create Firestore and Realtime Database, deploy rules/indexes/functions, and configure server-side secrets.

Firebase Web app values and the public Razorpay/VAPID keys are bundled into the browser app. They are public client configuration, not secrets; protect data with Firebase Security Rules. Do not put Razorpay secrets, VAPID private keys, or the Coturn shared secret in frontend variables.

## AWS Amplify Hosting

1. Connect the repository and branch in AWS Amplify. Amplify builds with `npm run build` and publishes `dist`.
2. Add the following values from your Firebase Web app in **App settings → Environment variables**:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_RAZORPAY_KEY_ID` (required for emergency extensions)
   - `VITE_VAPID_PUBLIC_KEY` (if browser push is enabled)
3. Add the Amplify hostname and any custom domain to Firebase Authentication's **Authorized domains** and the email-action redirect allowlist.
4. Configure the SPA rewrite to serve `/index.html` for application routes.
5. Deploy the site. Firebase Cloud Functions are deployed separately with `firebase deploy --only functions`.

## S3 + CloudFront

1. Copy `.env.production.example` to `.env.production` and enter the public frontend values above.
2. Run `npm ci` and `npm run build`.
3. Upload `dist/` to S3 and serve it through CloudFront with HTTPS.
4. Configure CloudFront custom error responses for 403 and 404 to return `/index.html` with HTTP 200 for client-side routes.
5. Add the CloudFront/custom-domain hostnames to Firebase Authentication's authorized domains and email redirect allowlist.

The included `deploy-aws-s3-cloudfront.ps1` can automate the upload and CloudFront invalidation when the AWS CLI and distribution permissions are configured.

## Docker / App Runner / ECS

Pass Firebase web configuration as Docker build arguments; these values are public client configuration:

```powershell
docker build `
  --build-arg VITE_FIREBASE_API_KEY="your-web-api-key" `
  --build-arg VITE_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com" `
  --build-arg VITE_FIREBASE_PROJECT_ID="your-project" `
  --build-arg VITE_FIREBASE_STORAGE_BUCKET="your-project.firebasestorage.app" `
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID="your-sender-id" `
  --build-arg VITE_FIREBASE_APP_ID="your-app-id" `
  --build-arg VITE_FIREBASE_DATABASE_URL="https://your-project-default-rtdb.firebaseio.com" `
  -t spider-app:latest .
```

Deploy server-side Functions to Firebase; do not copy Firebase Admin credentials or provider secrets into the static container.

## Production checklist

- Deploy `firestore.rules`, `firestore.indexes.json`, and `database.rules.json`.
- Deploy Cloud Functions and configure Razorpay, VAPID, and TURN secrets in Firebase Secret Manager.
- Create the ₹100/month INR Razorpay plan, set `RAZORPAY_MONTHLY_PLAN_ID` during Functions deployment, and configure the deployed subscription webhook URL with the matching webhook secret. See [`firebase/README.md`](./firebase/README.md).
- Use a custom SMTP provider for Firebase email authentication.
- Verify public Firestore reads do not expose private profiles, location coordinates, push endpoints, or payment records.
- Existing backend data and authentication accounts are not automatically copied. Follow the migration notes in [`firebase/README.md`](./firebase/README.md) before retiring the old backend.
