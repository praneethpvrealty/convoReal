# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Web ↔ mobile feature parity

Mobile and web are two surfaces of one product. Every user-facing feature must exist on both — see §2.8 of the root `AGENTS.md`, which is the authoritative statement of this rule.

- A feature you add here must also land on web; a feature already on web must land here.
- Business rules live server-side (`src/app/api/`) or in shared pure TypeScript (`src/lib/`). This app is a client of the same API — do not re-implement a rule natively so the two surfaces can drift.
- Before finishing, run `npm run typecheck`, `npm run lint`, and `npm test` from `mobile/`; the root scripts do not cover this directory.
