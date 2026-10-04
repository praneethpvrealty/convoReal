# Database migrations

Create schema changes with the official Supabase CLI:

```bash
supabase migration new descriptive_name
```

The CLI creates `supabase/migrations/<UTC timestamp>_descriptive_name.sql`. Do not choose the next three-digit number by hand: concurrent branches can select the same number without producing a Git conflict, leaving migration order ambiguous.

Three-digit prefixes through `293` are frozen legacy history. CI rejects any later sequential prefix while continuing to accept the existing files and 14-digit timestamp migrations.

Before opening a PR, reset or test against a disposable local/staging database and inspect the generated SQL. Production migrations are applied only through the repository's release process after the PR is green.

## Regenerating database types

`src/types/database.types.ts` is generated from the live schema; do not edit it by hand. A PR that adds a migration regenerates it once the migration is applied, so the typed clients see the new columns:

```bash
supabase gen types typescript --project-id <project-ref> > src/types/database.types.ts
npx prettier --write src/types/database.types.ts
```

The Supabase MCP `generate_typescript_types` tool produces the same file. Import `Database`, `Tables<'name'>`, `TablesInsert<'name'>`, `TablesUpdate<'name'>` and `TypedSupabaseClient` from `@/lib/supabase/database`.
