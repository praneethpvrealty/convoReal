import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261004140500_bootstrap_staff_account_invite_redeem.sql'
  ),
  'utf8'
);

describe('bootstrap_staff_account claims a seat atomically', () => {
  it('[ACC-001] locks the programme and the invitation while it checks and claims', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toMatch(/FROM beta_program WHERE id FOR UPDATE/);
    expect(sql).toMatch(
      /FROM beta_invites\s+WHERE token_hash = hash_beta_token\(v_beta_token\)\s+FOR UPDATE/
    );
    expect(sql).toContain('v_taken := beta_seats_taken();');
    expect(sql).toContain('seat_number = v_taken + 1');
  });

  it('[ACC-001] refuses Portfolio identities and runs only for the service role', () => {
    expect(sql).toContain('FROM den_users WHERE auth_user_id = p_user_id');
    expect(sql).toContain('FROM buyer_users WHERE auth_user_id = p_user_id');
    expect(sql).toContain("v_meta->>'app_context' IN ('den', 'buyer')");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.bootstrap_staff_account\(UUID, TEXT, TEXT\) FROM PUBLIC, anon, authenticated/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.bootstrap_staff_account\(UUID, TEXT, TEXT\) TO service_role/
    );
  });

  it('[ACC-001] mirrors the sign-up gate word for word', () => {
    for (const message of [
      'ConvoReal is invite-only right now.',
      'That invitation link is not valid.',
      'That invitation was withdrawn.',
      'That invitation has already been claimed.',
      'That invitation has expired.',
      'beta seats have been claimed.',
    ]) {
      expect(sql).toContain(message);
    }
    expect(sql).toContain(
      "VALUES (p_user_id, p_full_name, p_email, v_account_id, 'owner')"
    );
  });
});

describe('bootstrap_staff_account redeems a team invitation and serialises per user', () => {
  const body = sql.slice(sql.indexOf('BEGIN'), sql.indexOf('END;\n$$;'));
  const teamPath = body.slice(
    body.indexOf("v_team_token := NULLIF(v_meta->>'team_invite', '');"),
    body.indexOf('FROM beta_program WHERE id FOR UPDATE')
  );

  it('[ACC-001] takes a per-user advisory lock before it looks for a profile', () => {
    const lock = body.indexOf(
      "PERFORM pg_advisory_xact_lock(hashtextextended('bootstrap_staff_account:' || p_user_id::text, 0));"
    );
    const lookup = body.indexOf(
      'SELECT * INTO v_existing FROM profiles WHERE user_id = p_user_id;'
    );
    expect(lock).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(lock);
    expect(body.slice(0, lock).trim()).toBe('BEGIN');
  });

  it('[ACC-001] locks and validates the team invitation the way redeem_invitation does', () => {
    expect(teamPath).toMatch(
      /SELECT \* INTO v_inv FROM account_invitations\s+WHERE token_hash = hash_beta_token\(v_team_token\)\s+FOR UPDATE;/
    );
    expect(teamPath).toContain(
      'IF FOUND AND v_inv.accepted_at IS NULL AND v_inv.expires_at > NOW() THEN'
    );
    expect(body.indexOf(teamPath)).toBeGreaterThan(
      body.indexOf("v_meta->>'app_context' IN ('den', 'buyer')")
    );
  });

  it('[ACC-001] attaches the user to the inviting account with the invited role and spends the invitation', () => {
    expect(teamPath).toContain(
      'VALUES (p_user_id, p_full_name, p_email, v_inv.account_id, v_inv.role)'
    );
    expect(teamPath).toMatch(
      /UPDATE account_invitations\s+SET accepted_at = NOW\(\),\s+accepted_by_user_id = p_user_id\s+WHERE id = v_inv\.id;\s+RETURN v_inv\.account_id;/
    );
  });

  it('[ACC-001] never creates an account for a redeemed team invitation', () => {
    expect(teamPath).not.toContain('INSERT INTO accounts');
    expect(teamPath).not.toContain("'owner'");
    expect(body.indexOf('RETURN v_inv.account_id;')).toBeLessThan(
      body.indexOf('INSERT INTO accounts')
    );
    expect(body).not.toContain('v_team_ok');
  });
});
