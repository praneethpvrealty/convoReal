import 'server-only';

import { hashInviteToken } from '@/lib/beta/invites';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface BetaInvitePreview {
  ok: boolean;
  reason?: string;
  label?: string | null;
  inviter_name?: string | null;
  inviter_account?: string | null;
  expires_at?: string;
  seats_taken?: number;
  account_cap?: number;
}

export async function getBetaInvitePreview(
  token: string
): Promise<BetaInvitePreview | null> {
  if (!token) return null;

  const { data, error } = await supabaseAdmin().rpc('peek_beta_invite', {
    p_token_hash: hashInviteToken(token),
  });

  if (error || !data || typeof data !== 'object') return null;
  return data as BetaInvitePreview;
}
