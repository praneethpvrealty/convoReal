'use client';

import { useSearchParams } from 'next/navigation';

import { GuidanceValueWorkspace } from '@/components/guidance-value/guidance-value-workspace';

export default function GuidanceValuePage() {
  const searchParams = useSearchParams();
  return (
    <GuidanceValueWorkspace
      propertyId={searchParams.get('property')}
      dealId={searchParams.get('deal')}
    />
  );
}
