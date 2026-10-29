# Phone OTP authentication

Spider sign-in and sign-up use Supabase phone OTP. Sign-up collects full name, date of birth, and mobile number; the app generates an internal username for the existing profile schema.

## Supabase setup

1. In Supabase Authentication settings, enable the Phone provider and configure an SMS provider.
2. Set the provider's credentials and sender/originator according to its Supabase integration guide. Confirm SMS delivery in the provider and Supabase logs.
3. Configure OTP expiry and rate limits appropriate for the provider and region. Do not disable abuse protections.
4. Ensure the `handle_new_user` trigger in `supabase/schema.sql` is installed. It creates a profile from the name, generated username, phone, and date-of-birth metadata sent during sign-up.
5. Deploy the app over HTTPS and test with Supabase's configured test phone numbers before enabling real SMS delivery.

The **Remember me on this device** option stores the verified auth session in persistent browser storage. Without it, the session is kept in session storage and ends when the browser session closes. Existing Supabase local-storage sessions are migrated to session storage once unless Remember me was previously selected.

Existing email/password accounts are not automatically converted to phone OTP accounts. Each existing account must verify its phone number through a trusted migration flow before that phone can be used to sign in.
