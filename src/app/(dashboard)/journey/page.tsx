'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { legacyJourneyHref } from '@/lib/deals/routes';

export default function JourneyRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    router.replace(legacyJourneyHref(new URLSearchParams(searchParams)));
  }, [router, searchParams]);
  return null;
}
