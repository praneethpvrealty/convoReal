# Taking the app live

The repo side is prepared: `eas.json` build profiles, brand launcher
icon/splash, App-Link scaffolding, and `app.config.js` env injection.
What remains needs your accounts and credentials.

## One-time setup

```bash
npm install -g eas-cli
cd mobile
eas login            # free expo.dev account
eas init             # links this project to your account
```

Set the production environment (baked into the binary at build time):

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://<PROJECT>.supabase.co --environment production
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <ANON-KEY> --environment production
eas env:create --name EXPO_PUBLIC_API_BASE_URL --value https://www.convoreal.com --environment production
eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value <MAPS-KEY> --environment production
```

The Supabase values MUST match the deployed web app's project (see
`.env.example` — a mismatch means every API call fails Unauthorized).
`GOOGLE_MAPS_ANDROID_API_KEY` enables real native maps on Android —
create a key with "Maps SDK for Android" in Google Cloud, restricted
to the package `com.convoreal.app`.

## Builds

| Command | Output | Use |
|---------|--------|-----|
| `eas build -p android --profile preview` | installable APK link | fastest "live" for the team |
| `eas build -p android --profile production` | .aab | Play Store |
| `eas build -p ios --profile production` | .ipa | TestFlight / App Store (needs Apple Developer, $99/yr) |
| `eas submit -p android` / `-p ios` | — | store upload |

## After the first store build

1. **App Links / deep links** — set on the Vercel site:
   - `ANDROID_APP_CERT_SHA256` — Play Console → Setup → App signing →
     SHA-256 of the app signing key.
   - `APPLE_TEAM_ID` — from your Apple Developer account.
   Redeploy the site; then showcase links (`?property_id=…`) open the
   app on devices that have it.
2. **Play Console** ($25 one-time): privacy policy URL, Data safety
   form (declare the contacts permission — the app only uploads
   contacts the user picks), content rating, screenshots.
3. **App Store**: provide a demo staff login for review.

## Updating a live app

JS-only changes (most feature work) can ship over the air without a
store review:

```bash
eas update --channel production --message "what changed"
```

Native changes (new native modules, app.json plugins/permissions)
need a new `eas build` + store submission.

## Not yet wired (roadmap)

- Push notifications (needs a dev build to start; Expo Notifications +
  a send path from the queue worker).
- Crash reporting (e.g. Sentry) — recommended before wide rollout.
