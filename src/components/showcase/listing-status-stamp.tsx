import { listingAvailabilityNotice } from '@/lib/inventory/listing-availability';
import { cn } from '@/lib/utils';

interface ListingStatusStampProps {
  status: string | null | undefined;
  listingType?: string | null;
  size?: 'card' | 'detail';
}

export function ListingStatusStamp({
  status,
  listingType,
  size = 'card',
}: ListingStatusStampProps) {
  const notice = listingAvailabilityNotice(status, listingType);
  if (!notice) return null;
  const closed = notice.status === 'Sold';
  return (
    <div
      data-testid="listing-status-stamp"
      aria-hidden={size === 'detail' ? true : undefined}
      className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/25"
    >
      <span
        className={cn(
          '-rotate-12 rounded-lg border-4 font-black tracking-[0.14em] whitespace-nowrap uppercase shadow-2xl backdrop-blur-[2px]',
          closed
            ? 'border-rose-500 bg-rose-600/85 text-white'
            : 'border-amber-400 bg-amber-500/85 text-slate-950',
          size === 'detail'
            ? 'px-5 py-2 text-2xl sm:text-3xl'
            : 'px-3 py-1 text-lg'
        )}
      >
        {notice.label}
      </span>
    </div>
  );
}
