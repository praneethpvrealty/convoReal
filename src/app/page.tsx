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
  searchParams: Promise<{ account_id?: string }>;
}

// Server Component: fetches public listings & configuration details
export default async function RootPage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const admin = supabaseAdmin();

  // 1. Resolve Account ID
  let accountId = resolvedParams.account_id || process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT_ID;
  if (!accountId) {
    // If not set in environment, fall back to the first account in the CRM
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
  const { data: properties } = await admin
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .order('created_at', { ascending: false });

  // 4. Render
  return (
    <ShowcaseView
      properties={properties || []}
      settings={settings}
      accountId={accountId}
    />
  );
}
