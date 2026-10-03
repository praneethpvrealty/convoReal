import { Skeleton } from '@/components/dashboard/skeleton';
import { cn } from '@/lib/utils';

const BUBBLES: Array<{ side: 'in' | 'out'; width: string; lines: number }> = [
  { side: 'in', width: 'w-[52%]', lines: 2 },
  { side: 'out', width: 'w-[44%]', lines: 1 },
  { side: 'in', width: 'w-[60%]', lines: 3 },
  { side: 'out', width: 'w-[36%]', lines: 1 },
  { side: 'out', width: 'w-[48%]', lines: 2 },
  { side: 'in', width: 'w-[40%]', lines: 1 },
];

export function MessageThreadSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading messages"
      aria-busy="true"
      className="space-y-4"
    >
      {BUBBLES.map((bubble, i) => (
        <div
          key={i}
          data-testid="message-skeleton-bubble"
          className={cn(
            'flex',
            bubble.side === 'out' ? 'justify-end' : 'justify-start'
          )}
        >
          <div
            className={cn(
              'space-y-2 rounded-2xl px-4 py-3',
              bubble.width,
              bubble.side === 'out' ? 'bg-primary/15' : 'bg-slate-800/60'
            )}
          >
            {Array.from({ length: bubble.lines }, (_, line) => (
              <Skeleton
                key={line}
                className={cn(
                  'h-3',
                  line === bubble.lines - 1 ? 'w-2/3' : 'w-full'
                )}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
