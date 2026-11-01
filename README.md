# Hanuman

Hanuman is a peer-to-peer paid help marketplace built with React, TypeScript, and Vite.

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
3. In **Settings → Secrets and variables → Actions → Variables**, add the seven `VITE_FIREBASE_*` values from your Firebase Web app (including `VITE_FIREBASE_DATABASE_URL`). These are public client configuration values; do not add provider secrets as `VITE_` variables.
4. Open the **Actions** tab and wait for **Deploy Spider to GitHub Pages** to complete. The workflow checks that the Firebase variables are configured before building, and GitHub displays the published URL in the deployment.

The Vite build automatically uses the repository subpath for project Pages sites, such as `https://owner.github.io/repository/`, and the root path for `owner.github.io` repositories. To override this, set `VITE_BASE_PATH` for the build.

## Backend configuration

The app can render in local browser mode without Firebase and shows four clearly labeled sample community profiles and help requests there. Help requests can specify a virtual (in-app call) or in-person connection preference. Email/password authentication and marketplace data use Firebase Authentication and Cloud Firestore. Safety alerts, emergency payments, and in-app calling require Firebase Cloud Functions, Realtime Database, and their related provider setup. See [`firebase/README.md`](./firebase/README.md).
