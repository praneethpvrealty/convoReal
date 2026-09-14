'use client';

import { useParams } from 'next/navigation';

import { DealWorkspace } from '@/components/deals/deal-workspace';

export default function DealWorkspacePage() {
  const params = useParams<{ id: string }>();
  const dealId = typeof params?.id === 'string' ? params.id : '';

  if (!dealId) return null;

  return <DealWorkspace dealId={dealId} />;
}
