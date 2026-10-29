# Nearby safety SOS setup

The website SOS demo creates a 10-minute urgent request, rounds coordinates to three decimal places (about 100 metres), and sends a browser push notification to up to the sender's configured recipient limit inside the sender's configured radius (defaults: 25 people within 5 km). The recipient list is selected from saved approximate device locations. It does not contact emergency services or guarantee delivery.

## Supabase and VAPID configuration

1. Apply `safety_alerts_migration.sql` to the Supabase project after `schema.sql`.
2. Generate a VAPID key pair using a trusted Web Push library, for example:

   ```powershell
   npx web-push generate-vapid-keys --json
   ```

3. Configure the Supabase Edge Function secrets. Keep the private key server-side:

   ```powershell
   supabase secrets set VAPID_PUBLIC_KEY=<public-key> VAPID_PRIVATE_KEY=<private-key> VAPID_SUBJECT=mailto:admin@example.com
   ```

4. Deploy the authenticated function:

   ```powershell
   supabase functions deploy safety-alert
   ```

5. Add the same **public** VAPID key to the frontend build environment as `VITE_VAPID_PUBLIC_KEY`, then rebuild and deploy over HTTPS. The browser push API does not work on ordinary non-localhost HTTP.

Users must sign in, enable browser notifications, and opt in to share their approximate location from the profile/account section. The location remains associated with that browser's push subscription until alerts are disabled. The sender configures radius (500 m to 50 km) and recipient limit (1 to 25) in the profile/account section. The SOS sender's approximate location is included in the live Spider request and in notifications sent to opted-in users matching those limits.

The current integration is the website demo button. A physical IoT button/device still needs a device identity, secure credential provisioning, and a separate authenticated device-ingress endpoint before it can trigger this function.
