import type { Metadata } from 'next';

import { SharedRequirementsContent } from './shared-requirements-content';

export const metadata: Metadata = {
  title: 'Shared Requirements | ConvoReal',
  robots: { index: false, follow: false },
};

export default async function SharedRequirementsPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string; share?: string }>;
}) {
  const params = await searchParams;
  return (
    <SharedRequirementsContent
      initialBox={params.box === 'sent' ? 'sent' : 'received'}
      initialShareId={params.share || null}
    />
  );
}
