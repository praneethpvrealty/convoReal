import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrations = join(root, 'supabase/migrations');
const file = '20261006033422_internal_definer_functions_service_role_only.sql';
const migration = readFileSync(join(migrations, file), 'utf8');

const internalFunctions = [
  ['_bcast_bump', 'UUID, TEXT, INT'],
  ['bump_copilot_qa_hit', 'UUID'],
  ['vote_copilot_qa', 'UUID, BOOLEAN'],
  ['log_copilot_unmet_request', 'UUID, TEXT, TEXT, TEXT, TEXT, TEXT'],
  ['sync_contact_budget_band', 'UUID'],
  ['seed_default_reminder_templates', 'UUID, UUID'],
  ['claim_broadcast_dispatch', 'UUID, INT'],
  ['release_broadcast_dispatch', 'UUID'],
  ['renew_broadcast_dispatch', 'UUID, INT'],
  ['renew_broadcast_recipient_claims', 'UUID[]'],
  ['claim_broadcast_recipients', 'UUID, INT, INT'],
  ['recompute_broadcast_counts', 'UUID'],
] as const;

const serverCallers: Record<string, string> = {
  bump_copilot_qa_hit: 'src/lib/copilot/qa-cache.ts',
  vote_copilot_qa: 'src/lib/copilot/qa-cache.ts',
  log_copilot_unmet_request: 'src/lib/copilot/unmet.ts',
  claim_broadcast_dispatch: 'src/lib/broadcasts/sender.ts',
  release_broadcast_dispatch: 'src/lib/broadcasts/sender.ts',
  renew_broadcast_dispatch: 'src/lib/broadcasts/sender.ts',
  renew_broadcast_recipient_claims: 'src/lib/broadcasts/sender.ts',
  claim_broadcast_recipients: 'src/lib/broadcasts/sender.ts',
};

const triggerCallers = [
  [
    '_bcast_bump',
    '005_broadcast_counts_incremental.sql',
    'broadcast_recipient_aggregate_trigger',
  ],
  [
    'sync_contact_budget_band',
    '20260914162029_budget_band_tag_sync.sql',
    'contacts_budget_band_sync',
  ],
  [
    'seed_default_reminder_templates',
    '146_default_templates_and_manager_gate.sql',
    'handle_new_account_seed_templates',
  ],
] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name.startsWith('.')
          ? []
          : sourceFiles(path);
      }
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    }
  );
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('[ACC-005] internal SECURITY DEFINER write functions', () => {
  it.each(internalFunctions)(
    '%s is executable by the service role only',
    (name, args) => {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`
      );
    }
  );

  it('changes grants on exactly those functions and no function body', () => {
    const touched = [...migration.matchAll(/ON FUNCTION public\.(\w+)\(/g)].map(
      (m) => m[1]
    );
    expect([...new Set(touched)].sort()).toEqual(
      internalFunctions.map(([name]) => name).sort()
    );
    expect(migration).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
    expect(migration).not.toMatch(/TO (PUBLIC|anon|authenticated)\b/);
  });

  it('is called from application code only through the service-role client', () => {
    const called = new Map<string, Set<string>>();
    for (const path of [...sourceFiles('src'), ...sourceFiles('mobile')]) {
      const source = readFileSync(join(root, path), 'utf8');
      for (const [name] of internalFunctions) {
        if (new RegExp(`rpc\\(\\s*'${name}'`).test(source)) {
          called.set(name, (called.get(name) ?? new Set()).add(path));
        }
      }
    }
    for (const [name] of internalFunctions) {
      const expected = serverCallers[name];
      expect([...(called.get(name) ?? [])]).toEqual(expected ? [expected] : []);
    }
    for (const path of new Set(Object.values(serverCallers))) {
      const source = readFileSync(join(root, path), 'utf8');
      expect(source).toContain("from '@/lib/supabase/admin'");
      expect(source).not.toContain('@/lib/supabase/server');
      expect(source).not.toContain('@/lib/supabase/client');
    }
  });

  it.each(triggerCallers)(
    '%s is reached from SQL through a SECURITY DEFINER trigger function',
    (name, source, trigger) => {
      const sql = readFileSync(join(migrations, source), 'utf8');
      const start = sql.search(
        new RegExp(`CREATE OR REPLACE FUNCTION (public\\.)?${trigger}\\(`)
      );
      expect(start).toBeGreaterThan(-1);
      const rest = sql.slice(start + 1);
      const next = rest.search(/\nCREATE /);
      const body = next < 0 ? rest : rest.slice(0, next);
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toMatch(new RegExp(`PERFORM (public\\.)?${name}\\(`));
    }
  );

  it('is not reopened by a later migration', () => {
    const later = readdirSync(migrations)
      .filter((name) => /^\d{14}_/.test(name) && name > file)
      .map((name) => readFileSync(join(migrations, name), 'utf8'));
    for (const [name] of internalFunctions) {
      const fn = `FUNCTION (public\\.)?${escape(name)}\\(`;
      for (const sql of later) {
        expect(sql).not.toMatch(
          new RegExp(
            `GRANT [^;]*ON ${fn}[^;]*TO [^;]*\\b(PUBLIC|anon|authenticated)\\b`,
            'i'
          )
        );
        if (new RegExp(`(DROP|CREATE) ${fn}`).test(sql)) {
          expect(sql).toMatch(
            new RegExp(
              `REVOKE ALL ON ${fn}[^;]*FROM PUBLIC, anon, authenticated`
            )
          );
        }
      }
    }
  });
});
