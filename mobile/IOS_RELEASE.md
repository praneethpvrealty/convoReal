# Shipping the iOS build

Companion to `RELEASE.md`, which covers both platforms. This file is the
iOS-only path: what the repo already has, what is missing, and the exact
order to run things in. No Mac is required — EAS builds and signs in the
cloud.

## Readiness audit

Checked against the code in this directory on the branch this file
landed on.

### Ready

| Item | State |
|------|-------|
| Bundle identifier | `com.convoreal.app` (`app.json` → `ios.bundleIdentifier`) |
| EAS project | linked, `projectId` `35ac40bb-…` under owner `praneethpvrealtys-team` |
| Build profiles | `development` / `preview` / `production` in `eas.json`; production is store distribution with `autoIncrement` and `appVersionSource: "remote"`, so EAS owns the build number |
| App icon | `assets/images/icon.png`, 1024×1024, fully opaque — passes the App Store icon check |
| Splash / launch screen | `expo-splash-screen` plugin configured |
| Permission strings | location (when-in-use), contacts, photos, camera, Face ID all have purpose strings via config plugins — a missing `NS*UsageDescription` is the most common first rejection and none are missing |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` in `infoPlist`, so no per-build compliance questionnaire |
| Universal Links | `associatedDomains` declared; the site serves `/.well-known/apple-app-site-association` from `src/app/.well-known/apple-app-site-association/route.ts` |
| OTA updates | `expo-updates` with `runtimeVersion.policy: "fingerprint"` and an `updates.url` |
| Maps | `react-native-maps` with no `PROVIDER_GOOGLE`, so iOS uses Apple Maps — no extra key needed (the Google key is Android-only) |
| Typecheck | `npm run typecheck` passes clean |
| expo-doctor | 18/20 checks pass; the 2 failures are network reachability in this sandbox, not project problems |

### Blockers — fixed, but they need the migration deployed

**1. External purchase links (App Store Guideline 3.1.1).** Buying AI
credits or a plan is digital content consumed inside the app, so on
non-US storefronts Apple requires In-App Purchase or an approved
External Purchase Link entitlement — a "Top up on the web" button and an
"upgrade" CTA are the classic 3.1.1 rejection.

`lib/store-policy.ts` now exports `SHOW_PURCHASE_LINKS`
(`Platform.OS !== 'ios'`). On iOS the wallet balance, breakdown, plan
badge and ledger all still render — only the top-up button, its
"checkout opens in your browser" line and the plan card's upgrade CTA
are gone, which is what Guideline 3.1.3(b) allows for a multiplatform
service. Android is unchanged.

**2. No in-app account deletion (Guideline 5.1.1(v)).** Owners Den
signup happens inside the app, so the app must be able to delete an
account too.

- `DELETE /api/account/delete` — staff. An owner takes the workspace
  with them (teammates are first relocated to their own fresh accounts
  via `remove_account_member`, so nobody loses their login); a member
  deletes only their own profile and login.
- `DELETE /api/den/account` — Den. Deletes `den_users` (links CASCADE)
  and the auth user, revoking WhatsApp digest consent on the linked
  contacts on the way out. The agency's `contacts` rows stay — they are
  the agency's CRM records.
- `components/delete-account-row.tsx` — two-prompt destructive
  confirmation, wired into the More tab and Den settings.

**Before either endpoint works in production, apply
`supabase/migrations/168_account_deletion_fk_fixes.sql`.** Two columns
referenced `auth.users` in ways that make deleting a user impossible
(`contact_merge_log.merged_by` is NOT NULL with no ON DELETE action;
`marketplace_items.created_by` is NOT NULL with ON DELETE SET NULL).
Without the migration, deletion fails with a foreign-key error for any
user who has ever merged a contact.

The web app has no delete-account UI — Apple only requires it in the
app, but the two endpoints are shared and adding a Settings entry on the
web later is a UI-only change.

### Worth fixing, not blocking

- `app.json` `version` is `0.1.0`. Ship `1.0.0` — the marketing version
  is public on the store listing.
- `eas.json` `submit.production` is empty. Fill in the iOS block so
  `eas submit` is non-interactive and repeatable (see step 6).
- `npm run lint` fails here with "Cannot find module 'eslint'" —
  `expo lint` wants to install ESLint on first run and this sandbox has
  no registry access. Run it once on a networked machine.
- Push notifications are wired (`lib/push.ts` → `registerDevice`), but
  iOS remote push needs an APNs key in EAS credentials (step 3).
  Without it the token fetch fails silently and push is simply dead on
  iOS — the app still works.

## Prerequisites

- Apple Developer Program membership, $99/yr, on an Apple ID that is
  Account Holder or Admin. Enrollment can take 24–48 h — start there if
  it isn't done.
- Node 22 and `npm i -g eas-cli` (`eas.json` requires >= 16.0.0).
- `eas login` with the account that owns `praneethpvrealtys-team`.

## Steps

### 1. Apply the deletion migration

```
supabase/migrations/168_account_deletion_fk_fixes.sql
```

Run it in the Supabase SQL Editor against the production project before
the build ships, or account deletion 500s for anyone who has merged a
contact — and a broken delete button is worse in review than no delete
button.

### 2. Set the production environment

These are baked into the binary at build time. Same values the deployed
web app uses — a Supabase project mismatch makes every `/api/*` call
return Unauthorized.

```bash
cd mobile
eas env:create --name EXPO_PUBLIC_SUPABASE_URL      --value https://<PROJECT>.supabase.co --environment production
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <ANON-KEY>                    --environment production
eas env:create --name EXPO_PUBLIC_API_BASE_URL      --value https://www.convoreal.com     --environment production
eas env:list --environment production
```

`GOOGLE_MAPS_ANDROID_API_KEY` is not used by the iOS build.

### 3. Register the bundle ID and credentials

```bash
eas credentials -p ios
```

Sign in with the Apple ID when prompted and let EAS manage everything:

- **Distribution certificate** and **provisioning profile** — pick
  "Let EAS handle it". It registers `com.convoreal.app` on the developer
  portal if it isn't there yet.
- **Push Notifications Key (APNs)** — choose to set one up. This is what
  makes `getExpoPushTokenAsync` work in the production build and adds the
  `aps-environment` entitlement to the profile. An Apple team may only
  hold two APNs keys; reuse an existing one if you're at the limit.

### 4. Create the App Store Connect record

At https://appstoreconnect.apple.com → Apps → **+**:

- Platform iOS, name `ConvoReal` (must be globally unique on the store),
  primary language, bundle ID `com.convoreal.app`, SKU e.g. `convoreal-ios`.
- Note the **Apple ID** number it assigns — that is `ascAppId` in step 6.

### 5. Build

```bash
cd mobile
eas build -p ios --profile production
```

15–30 min in the queue + build. Output is a signed `.ipa`. For a
smoke test on your own device first, use
`eas build -p ios --profile preview` (internal distribution; register
the device UDID when prompted).

### 6. Submit to TestFlight / App Store

Add to `eas.json` so submits stop prompting:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "you@example.com",
      "ascAppId": "<the numeric Apple ID from step 4>",
      "appleTeamId": "<10-char Team ID>"
    }
  }
}
```

Then:

```bash
eas submit -p ios --latest
```

Apple processing takes 10–60 min. The build then appears in TestFlight.

### 7. Fill the App Store listing

Before review can start:

- **Screenshots** — 6.9" iPhone (1320×2868) is mandatory; iPad 13"
  (2064×2752) too, because `ios.supportsTablet` is `true`. Drop tablet
  support in `app.json` if you don't want to produce iPad screenshots
  and iPad-correct layouts.
- **Privacy Policy URL** — `https://www.convoreal.com/privacy` (page
  exists). Support URL and marketing URL as well.
- **App Privacy questionnaire** — declare honestly what the app collects:
  contacts (user-selected import), coarse/precise location (nearby
  search), name/email/phone (account), photos (listing uploads), and
  usage/diagnostics if any. Contacts and location need "linked to the
  user" answers because they land in the CRM under the account.
- **Sign-in demo account** — review cannot receive a WhatsApp OTP.
  Provide an email/password staff login (the fallback path in
  `app/(auth)/login.tsx`) in App Review Information, with a workspace
  that has sample contacts, properties and conversations so the reviewer
  sees a working app rather than empty states.
- **Notes for review** — say plainly that WhatsApp messaging requires a
  connected Meta WhatsApp Business account and that the demo workspace
  already has one, otherwise the inbox looks broken.
- **Age rating**, category (Business), and export compliance (already
  answered by the Info.plist key).

### 8. Turn on Universal Links

Once the Team ID exists, set `APPLE_TEAM_ID` in Vercel's production
environment and redeploy. Verify:

```bash
curl -s https://www.convoreal.com/.well-known/apple-app-site-association | jq
```

`applinks.details[0].appID` must read `<TEAMID>.com.convoreal.app`, be
served as JSON with no redirect. iOS caches this — reinstall the app to
re-fetch during testing.

### 9. Release

Submit for review from App Store Connect. First review is usually 24–48 h.
Use phased release for the first public version.

## After launch

JS-only changes ship over the air, no review:

```bash
eas update --channel production --message "what changed"
```

Anything native — a new Expo module, a plugin or permission change in
`app.json` — needs a new `eas build` and a new submission. The
`fingerprint` runtime version policy will refuse to hand a mismatched
update to an older binary, which is the behaviour you want.
