# ConvoReal Mobile (Android / iOS companion app)

React Native + Expo (SDK 52) companion app for the ConvoReal web CRM, per
[`docs/mobile-app-implementation-plan.md`](../docs/mobile-app-implementation-plan.md).
This directory is a self-contained npm project inside the monorepo — see the
plan's "Repository Strategy" section for why the app lives here and not in a
separate repo.

## Current state (Phase 1 scaffold)

- ✅ Email/password login against the shared Supabase project; session in
  secure storage (AES key in Keychain/Keystore, ciphertext in AsyncStorage —
  `lib/secure-store.ts`).
- ✅ Phone-verification gate mirroring the web (`phone_confirmed_at`,
  migration 137) — unverified users land on `app/(app)/verify-phone.tsx`.
- ✅ Inbox (conversations list) + conversation thread with **Supabase
  Realtime** live updates, backed by TanStack Query persisted to
  AsyncStorage for offline reads.
- ✅ Sending text replies through `POST /api/whatsapp/send` with
  `Authorization: Bearer` (the web repo's `src/lib/supabase/server.ts`
  accepts bearer tokens as of July 2026).
- ✅ Contacts tab with native dialer + WhatsApp deep links.
- ⏳ Phase 2+: media rendering via the auth-gated proxy, pending outbox &
  24-hour-window awareness, push notifications (needs `device_push_tokens`
  + worker dispatch — not yet in the web repo), templates, biometrics.

## Running it

```bash
cd mobile
npm install
cp .env.example .env   # fill in Supabase URL/anon key + web app base URL
npm start              # scan the QR code with Expo Go on Android
```

Expo Go (SDK 52) is enough for everything in Phase 1–2. Remote push
notifications (Phase 3) will require an EAS development build.

- `npm run typecheck` — TypeScript
- `npm run lint` — expo lint

## Layout

```
app/                    # expo-router file-based routes
  (auth)/login.tsx      # signed-out stack
  (app)/                # signed-in stack (guards: session + verified phone)
    (tabs)/             # Inbox / Contacts / Settings
    conversation/[id]   # message thread + composer
    verify-phone.tsx    # migration-137 gate
lib/
  supabase.ts           # shared Supabase client (RLS-scoped, auto-refresh)
  api.ts                # bearer-authenticated /api/* fetcher + typed wrappers
  auth-store.ts         # zustand session/profile store + auth listener
  query.ts              # TanStack Query client + AsyncStorage persister
  secure-store.ts       # LargeSecureStore (SecureStore 2KB limit workaround)
  types.ts              # trimmed mirrors of src/types (same column names)
```

## Conventions

- Direct table **reads** use the Supabase client (RLS scopes them);
  anything that touches WhatsApp or business logic goes through the
  Next.js API with a bearer token (`lib/api.ts`).
- Realtime channel names are account/user/conversation-scoped
  (`conversations:{accountId}:{userId}`, `messages:{conversationId}`) per
  the implementation plan.
- `messages.media_url` is a RELATIVE path — always resolve with
  `absoluteMediaUrl()` and fetch with `authHeaders()`.
