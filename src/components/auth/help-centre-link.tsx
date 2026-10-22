'use client';

import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import { useT } from '@/hooks/useLocale';

export function HelpCentreLink({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <p
      className={`flex items-center justify-center gap-1.5 text-center text-xs font-medium text-slate-500 ${className}`}
    >
      <LifeBuoy className="size-3.5" aria-hidden />
      {t('auth.needHelp')}{' '}
      <Link
        href="/help"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80"
      >
        {t('nav.helpCentre')}
      </Link>
    </p>
  );
}
