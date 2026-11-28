'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, type ComponentProps } from 'react';

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch'> & {
  href: string;
};

const PREFETCH_REUSE_MS = 30_000;

export function IntentPrefetchLink({
  href,
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...rest
}: IntentPrefetchLinkProps) {
  const router = useRouter();
  const prefetched = useRef<{ href: string; at: number } | null>(null);

  const prefetch = useCallback(() => {
    const now = Date.now();
    const last = prefetched.current;
    if (last?.href === href && now - last.at < PREFETCH_REUSE_MS) return;
    prefetched.current = { href, at: now };
    router.prefetch(href);
  }, [href, router]);

  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        prefetch();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        prefetch();
        onTouchStart?.(event);
      }}
    />
  );
}
