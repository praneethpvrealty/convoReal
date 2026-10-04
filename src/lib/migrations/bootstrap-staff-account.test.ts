import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261004090500_bootstrap_staff_account.sql'
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
