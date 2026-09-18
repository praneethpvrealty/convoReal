import type { Metadata } from 'next';

import { DealSharePortal } from '@/components/deals/deal-share-portal';
import { BRANDING } from '@/config/branding';

export const metadata: Metadata = {
  title: `Transaction update — ${BRANDING.name}`,
  description: 'A private view of one property transaction, shared with you by the agent.',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

// The stakeholder portal. Browser-bound public surface (root AGENTS.md
// §2.8 exception): the data comes from /api/public/deal-share, which
// re-validates the link on every call, so this page holds no state of
// its own beyond the OTP unlock the browser keeps for the session.
export default async function DealSharePage({ params }: PageProps) {
  const { token } = await params;
  return <DealSharePortal token={token} />;
}
