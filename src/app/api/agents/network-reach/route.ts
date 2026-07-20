import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { digestPeriod } from '@/lib/owners/owner-digest';
import {
  gatherAgentInventoryDigests,
  type PropertyReachStats,
} from '@/lib/agents/inventory-digest';

/**
 * GET /api/agents/network-reach
 *
 * The signed-in user's view of their OWN inventory travelling through
 * partner brokerages: every contact card across other tenants that
 * matches their phone (last 10 digits, same convention as Owners Den
 * linking) AND is referenced as the source agent of an agent-referred
 * listing, with per-property direct/indirect buyer reach — the same
 * numbers the WhatsApp digest reports, live on the dashboard once the
 * source agent signs up.
 *
 * Cross-tenant by design, so the reach query runs on the service-role
 * client via the SECURITY DEFINER lookup (find_agent_source_contacts,
 * migration 154); only aggregate reach stats and the partner
 * brokerage's display name are returned, never the partner's contacts
 * or listings themselves.
 */

const MAX_PARTNER_ACCOUNTS = 20;

interface NetworkReachAccount {
  accountName: string;
  properties: PropertyReachStats[];
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: profile } = await ctx.supabase
      .from('profiles')
      .select('phone')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const last10 = normalizePhone(profile?.phone).slice(-10);
    if (!last10) {
      return NextResponse.json({ data: { accounts: [] } });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: sourceContacts } = await admin.rpc('find_agent_source_contacts', {
      p_phone_last10: last10,
    });
    const partnerRows = ((sourceContacts || []) as Array<{
      contact_id: string;
      account_id: string;
    }>)
      .filter((row) => row.account_id !== ctx.accountId)
      .slice(0, MAX_PARTNER_ACCOUNTS);
    if (partnerRows.length === 0) {
      return NextResponse.json({ data: { accounts: [] } });
    }

    const period = digestPeriod('weekly');
    const accounts = (
      await Promise.all(
        partnerRows.map(async (row): Promise<NetworkReachAccount | null> => {
          const [{ data: account }, digests] = await Promise.all([
            admin.from('accounts').select('name').eq('id', row.account_id).maybeSingle(),
            gatherAgentInventoryDigests(admin, row.account_id, period, [row.contact_id]),
          ]);
          const properties = digests[0]?.properties ?? [];
          if (properties.length === 0) return null;
          return {
            accountName: (account?.name as string) || 'Partner brokerage',
            properties,
          };
        })
      )
    ).filter((a): a is NetworkReachAccount => a !== null);

    return NextResponse.json({ data: { accounts } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
