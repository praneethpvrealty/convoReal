import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ShowcaseView } from '@/components/showcase/showcase-view';

export const metadata: Metadata = {
  title: 'Aryavarta Ventures — Premium Real Estate & Land Listings',
  description:
    'Browse our handpicked collection of high-end villa plots, lands, apartments, and commercial spaces. Inquire directly via WhatsApp or submit a request.',
  robots: {
    index: true,
    follow: true,
  },
};

interface PageProps {
  searchParams: Promise<{ account_id?: string; ref?: string; agent_id?: string }>;
}

// Server Component: fetches public listings & configuration details
export default async function RootPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const admin = supabaseAdmin();

  let accountId = process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID;
  let filterContactId: string | null = null;
  let filterUserId: string | null = null;

  const ref = resolvedParams.ref || resolvedParams.account_id || resolvedParams.agent_id;

  if (ref) {
    // 1. Check if ref matches an account
    const { data: accountByRef } = await admin
      .from('accounts')
      .select('id')
      .eq('id', ref)
      .maybeSingle();

    if (accountByRef) {
      accountId = accountByRef.id;
    } else {
      // 2. Check if ref matches a contact (agent / seller / owner)
      const { data: contactByRef } = await admin
        .from('contacts')
        .select('account_id, id')
        .eq('id', ref)
        .maybeSingle();

      if (contactByRef) {
        accountId = contactByRef.account_id;
        filterContactId = contactByRef.id;
      } else {
        // 3. Check if ref matches a profile (agent user)
        const { data: profileByRef } = await admin
          .from('profiles')
          .select('account_id, user_id')
          .eq('user_id', ref)
          .maybeSingle();

        if (profileByRef) {
          accountId = profileByRef.account_id;
          filterUserId = profileByRef.user_id;
        }
      }
    }
  }

  // Fallback to default account if not resolved yet
  if (!accountId) {
    const { data: firstAccount, error: acctError } = await admin
      .from('accounts')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (!acctError && firstAccount) {
      accountId = firstAccount.id;
    }
  }

  // If no account could be resolved, return setup notice
  if (!accountId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-xl font-bold">Showcase Setup Pending</h2>
          <p className="text-sm text-slate-400">
            Please log in to the admin dashboard and configure your account settings.
          </p>
          <a
            href="/login"
            className="inline-block bg-primary text-primary-foreground font-bold px-4 py-2 rounded-lg text-xs hover:bg-primary-hover"
          >
            Go to Login Portal
          </a>
        </div>
      </div>
    );
  }

  // 2. Fetch Showcase Settings
  const { data: settings } = await admin
    .from('showcase_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  // 3. Fetch Published & Available Properties
  let query = admin
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available');

  if (filterContactId) {
    query = query.eq('owner_contact_id', filterContactId);
  } else if (filterUserId) {
    query = query.eq('user_id', filterUserId);
  }

  const { data: properties } = await query.order('created_at', { ascending: false });

  // 4. Render
  return (
    <ShowcaseView
      properties={properties || []}
      settings={settings}
      accountId={accountId}
      referrerContactId={filterContactId || undefined}
    />
  );
}
