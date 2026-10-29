# Shipping the Android build to Google Play

Companion to `RELEASE.md`, which covers both platforms. This file is the
Google Play path: what the repo already has, what changed for Play's
policies, and the exact order to run things in. Builds and signing run
on EAS; nothing needs Android Studio.

Publisher: an organization Play developer account, so there is no
12-tester / 14-day closed-test requirement — internal testing can be
promoted straight to production.

## Readiness audit

### Ready

| Item              | State                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Package name      | `com.convoreal.app` (`app.json` → `android.package`). Permanent once the first bundle is uploaded                                              |
| Target API        | compileSdk / targetSdk 36 from React Native 0.86, above Play's current minimum                                                                 |
| Build profile     | `production` in `eas.json`: `app-bundle` (.aab), `autoIncrement`, `appVersionSource: "remote"`, so EAS owns `versionCode`                      |
| Marketing version | `1.0.0` — it is public on the store listing                                                                                                    |
| Signing           | EAS-managed upload keystore (the July production build already used it). Play App Signing holds the real signing key                           |
| Account deletion  | In the app (More → Delete account; Den → Settings) and on the web at `/privacy#data-deletion`, which Play asks for as the "Delete account URL" |
| Privacy policy    | `/privacy` now has a mobile-app section matching the Data safety answers below                                                                 |
| App Links         | `intentFilters` with `autoVerify`; the site serves `/.well-known/assetlinks.json` from `ANDROID_APP_CERT_SHA256`                               |
| OTA updates       | `.github/workflows/eas-update.yml` publishes to `preview` and `production`, skipping a channel with no build at the current runtime            |
| Submit config     | `eas.json` → `submit.production.android`: `internal` track, `draft` release, so `eas submit` never publishes to users by itself                |

### Changed for Play policy

**Payments.** Play's Payments policy requires Google Play Billing for
digital goods bought in the app, and forbids links or calls to action
leading to another payment method. AI credits and plan upgrades are
digital goods, so `SHOW_PURCHASE_LINKS` (`lib/store-policy.ts`) is now
false on Android as well as iOS: the balance, breakdown, plan badge and
ledger still show; the "Top up on the web" button and the upgrade call
to action are gone. The app must not tell users to go to the website to
pay either — that is also steering. Owners buy on the web dashboard,
and purchases appear in the app straight away.

**Permissions.** The merged manifest was checked with
`expo prebuild -p android`. Removed:

- `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, added by
  `expo-audio` for background playback the app never uses
  (`enableBackgroundPlayback: false`). A declared foreground-service
  type needs its own Play Console declaration and a demo video.
- `SYSTEM_ALERT_WINDOW` (draw over other apps) — `blockedPermissions`.
- `WRITE_CONTACTS`, added by `expo-contacts` — the app only reads the
  contacts a user picks.

What remains: internet, coarse/fine location (foreground only), read
contacts, record audio, biometrics, vibrate, notifications, and storage
read/write capped at API 32 for the image picker on old devices.

These are native changes, so they moved the runtime fingerprint. The
preview APKs already installed stop receiving OTA updates until they
install a new preview build — run the **EAS Preview Build** workflow
once after this lands.

## Steps, in order

### 1. Create the app in Play Console

Play Console → Create app: name **ConvoReal**, default language English
(India), **App**, **Free**, accept the declarations.

### 2. Build the bundle

```bash
cd mobile
eas build -p android --profile production
```

### 3. First upload by hand

Google's API cannot create an app's first release, so `eas submit`
fails until one exists. Download the `.aab` from the EAS build page and
upload it under Testing → Internal testing → Create release. Add the
team as internal testers.

### 4. App signing fingerprint → App Links

Play Console → Test and release → App integrity → App signing: copy
the SHA-256 of the **app signing key** and of the **upload key**. Set
both, comma-separated, as `ANDROID_APP_CERT_SHA256` on the Vercel
production project and redeploy. The signing key covers Play installs;
the upload key (the EAS keystore) covers sideloaded preview APKs.
Check `https://www.convoreal.com/.well-known/assetlinks.json` lists them.

### 5. Service account, so later submits are one command

1. Google Cloud console → IAM → Service accounts → create one, then
   Keys → Add key → JSON.
2. Play Console → Users and permissions → Invite the service account's
   email with "Release to testing tracks" and "Manage testing tracks"
   (add "Release to production" if production promotes should be
   scripted too).
3. `eas credentials -p android` → production → Google Service Account →
   upload the JSON. It lives on EAS, never in the repo.

From then on: `eas submit -p android --profile production --latest`.

### 6. Store listing

Main store listing needs:

- App icon 512×512 PNG (scale `assets/images/icon.png`).
- Feature graphic 1024×500.
- At least 2 phone screenshots (16:9 or 9:16, 1080px wide works).
- Short description (80 chars) and full description (4000 chars).

### 7. App content

| Section                | Answer                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Privacy policy         | `https://www.convoreal.com/privacy`                                                                        |
| App access             | Restricted — provide a demo staff login (email + password) with sample data, and note WhatsApp is optional |
| Ads                    | No ads                                                                                                     |
| Content rating         | Questionnaire: utility/productivity, no user-to-user public content, no violence                           |
| Target audience        | 18 and over                                                                                                |
| Data safety            | See below                                                                                                  |
| Government / financial | No / No                                                                                                    |
| Delete account URL     | `https://www.convoreal.com/privacy#data-deletion`                                                          |

**Data safety.** Data is encrypted in transit; users can request
deletion; nothing is shared with third parties in Google's sense
(Sentry and Supabase are service providers; sending a WhatsApp message
is a user-initiated transfer).

| Data type                        | Collected | Purpose                               | Optional |
| -------------------------------- | --------- | ------------------------------------- | -------- |
| Name, email, phone number        | Yes       | Account management, app functionality | No       |
| Contacts                         | Yes       | App functionality (picked contacts)   | Yes      |
| Approximate and precise location | Yes       | App functionality (nearby listings)   | Yes      |
| Photos                           | Yes       | App functionality                     | Yes      |
| Voice or sound recordings        | Yes       | App functionality                     | Yes      |
| Other in-app messages            | Yes       | App functionality                     | No       |
| Crash logs, diagnostics          | Yes       | Analytics (stability)                 | No       |
| Device or other IDs (push token) | Yes       | App functionality                     | Yes      |

### 8. Promote to production

Once internal testers have signed off: Release → Production → Create
release from the internal build, rollout 20% first. New apps get a
review that can take up to a week.

## After it is live

JS-only changes reach Play installs through `eas-update.yml` on the
`production` channel. A native change (new module, plugin or
permission) needs a new `eas build -p android --profile production` and
a submit; the workflow warns and skips `production` until that build
exists.
