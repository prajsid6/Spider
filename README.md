# Hanuman

Hanuman is a peer-to-peer paid help marketplace built with React, TypeScript, and Vite. Production marketplace access requires a ₹100/month Razorpay subscription for each requester or helper account; emergency-alert extensions use a separate one-time payment.

## Run locally

```sh
npm ci
npm run dev
```

## Build

```sh
npm run build
```

The production site is written to `dist`.

## Deploy to GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` builds and deploys the site whenever code is pushed to `main`.

1. Push the repository to GitHub on the `main` branch.
2. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Ensure the seven `VITE_FIREBASE_*` values in `.env.production.example` match your Firebase Web app. These are public client configuration values; do not put provider secrets in this file. The Pages workflow builds with these Firebase values and does not require repository Actions variables.
4. Open the **Actions** tab and wait for **Deploy Spider to GitHub Pages** to complete. The workflow checks the production Firebase configuration before building, and GitHub displays the published URL in the deployment.

The Vite build automatically uses the repository subpath for project Pages sites, such as `https://owner.github.io/repository/`, and the root path for `owner.github.io` repositories. To override this, set `VITE_BASE_PATH` for the build.

## Backend configuration

The app can render in local browser mode without Firebase and shows four clearly labeled sample community profiles and help requests there. Help requests can specify a virtual (in-app call) or in-person connection preference. Email/password authentication and marketplace data use Firebase Authentication and Cloud Firestore. Safety alerts, emergency payments, and in-app calling require Firebase Cloud Functions, Realtime Database, and their related provider setup. See [`firebase/README.md`](./firebase/README.md).
