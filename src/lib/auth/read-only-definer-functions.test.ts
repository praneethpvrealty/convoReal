import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = join(process.cwd(), 'supabase/migrations');

const migration = readFileSync(
  join(migrations, '20261005114500_definer_write_functions_read_only.sql'),
  'utf8'
);

const writeFunctions = [
  ['allocate_invoice_number', "is_account_writer(p_account_id, 'agent')"],
  ['deal_invoice_append', "is_account_writer(v_account_id, 'agent')"],
  ['deal_invoice_remove', "is_account_writer(v_account_id, 'agent')"],
  ['issue_invoice', "is_account_writer(v_invoice.account_id, 'agent')"],
  ['journey_show_captured', "is_account_writer(p_account_id, 'agent')"],
  [
    'sync_listing_status_from_deals',
    "is_account_writer(p_account_id, 'agent')",
  ],
  ['resync_pipeline_stage_deals', "is_account_writer(v_account, 'admin')"],
  [
    'revoke_beta_invite',
    "is_account_writer(v_inv.issued_by_account_id, 'admin')",
  ],
  [
    'rotate_beta_invite',
    "public.is_account_writer(v_inv.issued_by_account_id, 'admin')",
  ],
  ['unmap_portal_ad', "is_account_writer(p_account_id, 'agent')"],
] as const;

function definition(name: string) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = migration.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('[ACC-004] read-only members and SECURITY DEFINER write functions', () => {
  it.each(writeFunctions)(
    '%s guards its write with is_account_writer',
    (name, guard) => {
      const body = definition(name);
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toContain(guard);
      expect(body).not.toContain('is_account_member(');
    }
  );

  it('redefines exactly those functions', () => {
    const defined = [
      ...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map((m) => m[1]);
    expect([...defined].sort()).toEqual(
      writeFunctions.map(([name]) => name).sort()
    );
  });

  it('still lets server code holding the service role sync a listing status', () => {
    expect(definition('sync_listing_status_from_deals')).toMatch(
      /auth\.role\(\) IS DISTINCT FROM 'service_role'\s+AND NOT is_account_writer\(p_account_id, 'agent'\)/
    );
  });

  it('keeps the read-only refusal complete_copilot_appointment already makes', () => {
    const copilot = readFileSync(
      join(migrations, '20260902111312_copilot_confirmed_actions.sql'),
      'utf8'
    );
    expect(copilot).toMatch(
      /IF NOT FOUND OR v_is_read_only IS NOT FALSE THEN\s+RAISE EXCEPTION 'Read-only members cannot execute Copilot actions'/
    );
  });

  it('is the latest definition of each function', () => {
    const later = readdirSync(migrations)
      .filter((file) => /^\d{14}_/.test(file))
      .filter(
        (file) => file > '20261005114500_definer_write_functions_read_only.sql'
      )
      .map((file) => readFileSync(join(migrations, file), 'utf8'));
    for (const [name] of writeFunctions) {
      const redefinition = new RegExp(
        `CREATE (OR REPLACE )?FUNCTION (public\\.)?${name}\\(`
      );
      for (const sql of later) {
        if (!redefinition.test(sql)) continue;
        const start = sql.search(redefinition);
        expect(sql.slice(start, sql.indexOf('\n$$;', start))).toContain(
          'is_account_writer('
        );
      }
    }
  });
});
