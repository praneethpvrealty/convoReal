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
eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value <MOBILE-DSN> --environment production
eas env:create --name EXPO_PUBLIC_SENTRY_ENVIRONMENT --value production --environment production
```

The Supabase values MUST match the deployed web app's project (see
`.env.example` — a mismatch means every API call fails Unauthorized).
`GOOGLE_MAPS_ANDROID_API_KEY` enables real native maps on Android —
create a key with "Maps SDK for Android" in Google Cloud, restricted
to the package `com.convoreal.app`.

The Sentry values are what make the `convoreal-mobile` project report
anything. `Sentry.init()` in `lib/monitoring.ts` is gated on
`enabled: Boolean(dsn)`, so a build without `EXPO_PUBLIC_SENTRY_DSN`
sends nothing and raises no error — the project simply reads as having
no activity, which is indistinguishable from an app that never crashes.
The DSN is baked in at build time, so setting it does not reach any
already-installed app: it takes a new build, not an OTA update. Take the
DSN from Sentry → convoreal-mobile → Settings → Client Keys (DSN); it is
safe to embed. `SENTRY_AUTH_TOKEN` is not, and belongs only in EAS build
secrets for source-map upload.

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

JS-only changes (most feature work) ship over the air without a store
review, and **`.github/workflows/eas-update.yml` does it automatically**
when a change under `mobile/` lands on `main`. It re-runs lint,
typecheck and tests on the merged tree, then refuses to publish anything
no installed app could receive. Publish by hand only for a change that
did not go through `main`:

```bash
eas update --channel preview --environment preview --message "what changed"
```

Three things decide whether an update reaches anybody. The workflow
checks all three; if you publish by hand, you are the check.

**The channel must be the one the installed apps were built on.** A
channel maps to the same-named branch, and an app only ever receives
updates on the channel baked into its binary. Every recent build is
`preview`. `production` is not an alias for "the real one": its only
build predates the fingerprint runtime policy, so nothing published
there today can ever match it, and two updates already sit on that
branch having reached nobody.

**The runtime version must match a real build.** `runtimeVersion` is on
the `fingerprint` policy, so a JS-only change keeps it — nothing under
`app/` or `lib/` is a fingerprint source. A bumped dependency, an
app.json plugin or a new permission moves it, and an update at a runtime
no installed build carries is ignored in silence: the app reports itself
up to date and stays on the old bundle. That case needs `eas build`, not
an update. See `fingerprint.config.js` for a way the runtime once moved
by accident.

```bash
eas fingerprint:generate -p android --environment preview   # what this tree is
eas build:list --channel preview --platform android --status finished --limit 5
```

Note `fingerprint:generate --json` prefixes stdout with a plain-English
line about loaded environment variables, so piping it straight into a
JSON parser fails — read from the first `{`.

**`--environment` decides which EAS variables get baked into the
bundle**, and is required under `--non-interactive`. Match it to the
profile the builds used or the update ships pointing at another backend,
which no test catches. `preview` and `production` currently hold the
same four values.

### iOS is not currently reachable

The only iOS build ever made is a simulator build (`preview-sim`,
runtime `1d747312…`), and the project has since moved past that runtime.
Until a real iOS build exists, iOS updates reach nothing — the workflow
skips iOS with a warning and publishes Android alone rather than failing
the run. `eas build -p ios --profile preview` (or `production`, for
TestFlight) is what closes that; see `IOS_RELEASE.md`.

Native changes (new native modules, app.json plugins/permissions)
need a new `eas build` + store submission.

## Not yet wired (roadmap)

- Push notifications (needs a dev build to start; Expo Notifications +
  a send path from the queue worker).
- Crash reporting (e.g. Sentry) — recommended before wide rollout.
