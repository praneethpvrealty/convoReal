'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { legacyPipelinesHref } from '@/lib/deals/routes';

export default function PipelinesRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    router.replace(legacyPipelinesHref(new URLSearchParams(searchParams)));
  }, [router, searchParams]);
  return null;
}
