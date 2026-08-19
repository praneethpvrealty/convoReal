# Database migrations

Create schema changes with the official Supabase CLI:

```bash
supabase migration new descriptive_name
```

The CLI creates `supabase/migrations/<UTC timestamp>_descriptive_name.sql`. Do not choose the next three-digit number by hand: concurrent branches can select the same number without producing a Git conflict, leaving migration order ambiguous.

Three-digit prefixes through `293` are frozen legacy history. CI rejects any later sequential prefix while continuing to accept the existing files and 14-digit timestamp migrations.

Before opening a PR, reset or test against a disposable local/staging database and inspect the generated SQL. Production migrations are applied only through the repository's release process after the PR is green.
