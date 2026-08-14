# Maestro e2e on the iOS Simulator

Smoke flows that drive the real app on a booted simulator: email login →
inbox → contacts → properties → More → Connection check. Selectors are
`testID`s (`id:` in the YAML) so UI copy can change freely; the ids live
on the login screen, the tab bar (`tabBarButtonTestID`), each tab's
`SearchBar`, and the More menu rows (`menu-<id>` from `lib/menu.ts`).
Only the Connection check assertions match text, because the row labels
are the thing under test.

## One-time setup (Mac)

```bash
curl -fsSL https://get.maestro.mobile.dev | bash   # installs to ~/.maestro/bin
brew install openjdk@17                            # Maestro needs a JRE
```

## Get the app onto a simulator

Either build locally:

```bash
cd mobile
npx expo run:ios   # prebuild + compile + installs on the default simulator
```

or install a cloud simulator build (`eas build -p ios --profile preview-sim`,
then `eas build:run -p ios --latest`).

The binary must be built with the right `EXPO_PUBLIC_*` values — the
`connection-check` flow fails if the Supabase project or API base is wrong,
which is exactly what it is for.

## Run

Credentials come from `MAESTRO_`-prefixed environment variables. Use a
staff login whose phone is already verified — an unverified account lands
on the verify-phone gate instead of the inbox and every flow fails from
there.

```bash
cd mobile
export MAESTRO_EMAIL="agent@example.com"
export MAESTRO_PASSWORD="…"
maestro test .maestro          # whole suite, in config.yaml order
maestro test .maestro/flows/01-login.yaml   # single flow
```

Screenshots land in `mobile/.maestro/shots/` (git-ignored). `01-login`
clears app state and signs in; the later flows reuse that session, so run
the suite in order — or run `01-login` first when running one flow alone.

## Debugging selectors

`maestro studio` opens an inspector against the booted simulator showing
the live view hierarchy — use it when a selector stops matching.

Push, camera, and WhatsApp OTP are out of scope in the simulator; these
flows deliberately avoid them.
