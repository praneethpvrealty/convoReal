import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260824114725_secure_beta_invite_issuance.sql',
  'utf8'
);
const tenantRoute = readFileSync('src/app/api/beta-invites/route.ts', 'utf8');
const seedRoute = readFileSync(
  'src/app/api/admin/beta-invites/seed/route.ts',
  'utf8'
);
const phoneBindingMigration = readFileSync(
  'supabase/migrations/20260825120323_bind_beta_invites_to_verified_phone.sql',
  'utf8'
);
const rotationMigration = readFileSync(
  'supabase/migrations/20260825124808_rotate_beta_invite_tokens.sql',
  'utf8'
);

describe('beta invite issuance privilege boundary', () => {
  it('removes the caller-controlled seed flag from the tenant RPC', () => {
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS public.issue_beta_invite(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)'
    );
    expect(tenantRoute).not.toContain('p_as_seed');
  });

  it('keeps seed issuance service-role-only at both grant and runtime', () => {
    expect(seedRoute).toMatch(/admin\.rpc\(['"]issue_beta_seed['"]/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.issue_beta_seed[\s\S]*?FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.issue_beta_seed[\s\S]*?TO service_role;/
    );
    expect(migration).toContain(
      "IF auth.role() IS DISTINCT FROM 'service_role' THEN"
    );
  });

  it('does not expose tenant issuance to anon', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.issue_beta_invite[\s\S]*?FROM PUBLIC, anon;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.issue_beta_invite[\s\S]*?TO authenticated, service_role;/
    );
  });
});

describe('beta invite phone binding', () => {
  it('checks the database invite phone during the first verified phone update', () => {
    expect(phoneBindingMigration).toContain('JOIN public.beta_invites bi');
    expect(phoneBindingMigration).toContain('OLD.phone_confirmed_at IS NULL');
    expect(phoneBindingMigration).toContain('regexp_replace(NEW.phone');
    expect(phoneBindingMigration).toContain(
      'This invitation is reserved for a different WhatsApp number.'
    );
  });

  it('does not swallow a phone-binding rejection', () => {
    expect(phoneBindingMigration).toMatch(
      /WHEN SQLSTATE '22023' THEN\s+RAISE;/
    );
  });
});

describe('beta invite token rotation', () => {
  it('locks and authorizes the existing invite before rotating it', () => {
    expect(rotationMigration).toContain('WHERE id = p_id\n  FOR UPDATE');
    expect(rotationMigration).toContain('public.is_account_member');
    expect(rotationMigration).toContain("v_inv.status <> 'pending'");
  });

  it('keeps the privileged RPC away from anonymous and service roles', () => {
    expect(rotationMigration).toContain("SET search_path = ''");
    expect(rotationMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.rotate_beta_invite[\s\S]*?FROM PUBLIC, anon, service_role;/
    );
    expect(rotationMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.rotate_beta_invite[\s\S]*?TO authenticated;/
    );
  });

  it('preserves the same invite row and recipient while changing credentials', () => {
    expect(rotationMigration).toContain('SET token_hash = p_token_hash');
    expect(rotationMigration).toContain("'label', v_inv.label");
    expect(rotationMigration).toContain("'invitee_phone', v_inv.invitee_phone");
    expect(rotationMigration).not.toContain('INSERT INTO public.beta_invites');
  });
});
