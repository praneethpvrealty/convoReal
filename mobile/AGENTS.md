# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Web ↔ mobile feature parity

Mobile and web are two surfaces of one product. Every user-facing feature must exist on both — see §2.8 of the root `AGENTS.md`, which is the authoritative statement of this rule.

- A feature you add here must also land on web; a feature already on web must land here.
- Business rules live server-side (`src/app/api/`) or in shared pure TypeScript (`src/lib/`). This app is a client of the same API — do not re-implement a rule natively so the two surfaces can drift.
- Before finishing, run `npm run typecheck`, `npm run lint`, and `npm test` from `mobile/`; the root scripts do not cover this directory.

# Importing web code at runtime

`@shared/*` maps to `../src/*` in the type checker, in Vitest and in Metro (`metro.config.js`, `shared-resolver.js`), so a pure rule in `src/lib/` can be imported as a value, not only as a type. Prefer that to hand-copying a rule into `lib/` behind a parity test.

- Only dependency-free modules can cross. A module reached through `@shared/` may import other `src/` files by relative path and nothing else — no packages, no `@/` alias, no Node built-ins. Metro refuses anything else at bundle time, and `[SHR-003]` in `src/lib/mobile-parity.test.ts` refuses it on the web side, where an edit to the shared file is actually tested. `import type` is erased and stays unrestricted.
- Reach `src/` only through `@shared/`. A relative path into `../src`, or `@/` falling back to it, is refused.
- Split a mixed web module rather than loosening the rule: move the pure part into an import-free file and have the original re-export it, as `src/lib/calendar/archive-sort.ts` does for `tasks-view.ts`.
- `experiments.onDemandFilesystem` is off in `app.config.js` so the export keeps `../src` as a watch folder; `fingerprint.config.js` drops it from the runtime fingerprint because it has no native effect. Keep both, or every `@shared/` runtime import stops resolving on `expo export` and `eas update`.
