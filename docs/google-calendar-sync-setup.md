# Google Calendar sync setup

ConvoReal pushes each member's appointments and dated open to-dos into a
calendar named "ConvoReal" in their own Google account (CAL-015). It reuses
the Google OAuth client that YouTube upload already uses
(`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`), so there is no new
environment variable.

## One-time setup in Google Cloud

1. Open the Google Cloud project that holds the OAuth client.
2. **APIs & Services → Library:** enable the **Google Calendar API**.
3. **APIs & Services → Credentials →** the web OAuth client: add this
   authorised redirect URI, using the value of `NEXT_PUBLIC_APP_URL` (or
   `NEXT_PUBLIC_SITE_URL`):

   ```
   https://<your app domain>/api/google-calendar/oauth/callback
   ```

4. **OAuth consent screen → Data access:** add the scopes
   `https://www.googleapis.com/auth/calendar.app.created` and `email`.

## Verification

`calendar.app.created` is a sensitive scope. Until the app passes Google's
verification, people who connect see an "unverified app" warning, and at
most 100 users can grant it. Submit the consent screen for verification
before rolling the feature out widely.

## How it runs

- `/api/cron/google-calendar-sync` runs every 15 minutes and reconciles up to
  40 connections per run, least recently synced first.
- Members can press **Sync now** for an immediate run.
- A revoked grant marks the connection `token_expired` and the member is
  asked to reconnect. A calendar the member deletes in Google is recreated on
  the next run.
- **Disconnect** deletes the stored token and the event links. It does not
  revoke the Google grant, because YouTube upload uses the same OAuth client
  and revoking would also cut off an owner who connected YouTube with the
  same Google account. A member who wants to remove access entirely does it
  at myaccount.google.com → Security → Third-party connections. The
  ConvoReal calendar stays in their Google account until they delete it.
