import { Skeleton } from '@/components/dashboard/skeleton';

export const CONTACTS_SKELETON_ROWS = 8;

const COLUMNS = [
  'w-32',
  'w-14',
  'w-28',
  'w-36',
  'w-24',
  'w-20',
  'w-20',
  'w-14',
] as const;

export function ContactsTableSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading contacts"
      aria-busy="true"
      className="min-w-0"
    >
      <div className="flex items-center gap-6 border-b border-slate-800 px-4 py-3">
        {COLUMNS.map((width, i) => (
          <Skeleton key={i} className={`h-3 ${width} shrink-0`} />
        ))}
      </div>
      {Array.from({ length: CONTACTS_SKELETON_ROWS }, (_, row) => (
        <div
          key={row}
          data-testid="contacts-skeleton-row"
          className="flex items-center gap-6 border-b border-slate-800/60 px-4 py-4 last:border-b-0"
        >
          {COLUMNS.map((width, i) => (
            <Skeleton
              key={i}
              className={`shrink-0 ${width} ${i === 3 ? 'h-5 rounded-full' : 'h-3.5'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
