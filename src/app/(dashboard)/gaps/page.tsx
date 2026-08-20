'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** The 6am digest links here; the screen itself lives as a dashboard
 *  tab, like Radar and Pulse. */
export default function GapsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard?tab=gaps');
  }, [router]);
  return null;
}
