# Dicestack Dimension

The standalone social-platform project for the dicestack88 community.

## Development status

The project contains a static landing page and a Supabase-backed authentication foundation in progress:
- Supabase Auth client integration for login
- Registration form with username and display-name metadata
- Email-confirmation redirect and verified-user checks
- Protected account page that loads the signed-in user's profile
- Registration intentionally disabled during development

## Supabase setup (before testing)

1. In Supabase Project Settings → API, copy the publishable key (or legacy anon key).
2. Open assets/js/supabase-config.js and replace the placeholder with that key.
3. Never use a service_role key or secret key in browser code or commit one to GitHub.
4. In Supabase Authentication → URL Configuration, set the Site URL to:
   https://dicestack88.github.io/dimension/
5. Add this exact Redirect URL to the allowed redirect URLs:
   https://dicestack88.github.io/dimension/login.html?verified=1
6. Keep Confirm email enabled.
7. Keep REGISTRATION_ENABLED set to false until the account flow and policies have been reviewed and tested.

The Supabase URL and browser publishable/anon key are public client configuration. Database access must remain protected by Row Level Security. The service-role key must never be exposed to the browser.

## Account identity rules

The database migration enforces lowercase usernames (3–20 characters; letters, numbers and underscores), display names (1–32 characters), and immutable identity fields. Registration sends both values as Supabase Auth user metadata so the database trigger can create the matching profile.

## Important testing notes

- Do not use real personal passwords during initial development.
- Registration remains closed by default.
- The protected account page checks for a signed-in user with a confirmed email before showing profile content.
- This is an authentication foundation, not a finished social platform. Clips, comments, friends and messaging are not implemented yet.

## Local preview

Open index.html in a browser, or serve this folder with a local HTTP server. Supabase email redirects and GitHub Pages paths should be tested using the deployed site URL.

## Deployment

https://dicestack88.github.io/dimension/


## GIF comments and device notifications

The clip feed supports threaded text comments. Migration `020_gif_comments_and_device_push.sql` adds Tenor GIF references to comments and per-device Web Push subscriptions.

Before enabling these features:

1. Run migration 020 in the linked Supabase project's SQL editor.
2. Configure the Netlify environment variables and Supabase Vault secrets described in the `dicestack-netlify-api` repository README.
3. Deploy the updated Netlify API.
4. Push notifications require a supported browser, a secure context, and explicit permission. On iPhone/iPad, install Dimension to the Home Screen before enabling push.
5. GIF search requires a Tenor API key configured as `TENOR_API_KEY` in Netlify. GIF media is proxied through Netlify and capped at 3 MB per response.

The in-app notification badge and notification centre use Supabase Realtime after migration 020 is applied. Browser push is delivered separately through the Netlify function and VAPID configuration.
