# Razorpay urgent-alert extensions

The urgent-alert duration choices are 10, 20, and 30 minutes at ₹5 per minute. The alert owner can purchase a 5-minute extension for ₹25 from a live alert card.

## Supabase setup

1. Apply `razorpay_extension_migration.sql` to the Supabase project after the marketplace schema.
2. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as Edge Function secrets in the Supabase dashboard. Use Razorpay test credentials before enabling live payments; never put the secret in a `VITE_` variable or commit it.
3. Deploy the `emergency-extension` Edge Function:

   ```powershell
   supabase functions deploy emergency-extension
   ```

4. Set `VITE_RAZORPAY_KEY_ID` in the frontend environment to the same Razorpay key ID, then rebuild and deploy the app.

The function authenticates the signed-in Supabase user, creates fixed ₹25 Razorpay orders, verifies the checkout signature and captured payment with Razorpay, and extends only that user's active urgent alert. Payment state and alert expiry are updated server-side.

Demo/local-storage mode does not support paid extensions. Configure Supabase and Razorpay before using the purchase action.
