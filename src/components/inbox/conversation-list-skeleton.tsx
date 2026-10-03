import { Skeleton } from '@/components/dashboard/skeleton';

export const CONVERSATION_SKELETON_ROWS = 8;

export function ConversationListSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading conversations"
      aria-busy="true"
      className="flex flex-col"
    >
      {Array.from({ length: CONVERSATION_SKELETON_ROWS }, (_, i) => (
        <div
          key={i}
          data-testid="conversation-skeleton-row"
          className="flex w-full items-start gap-3 border-l-2 border-l-transparent px-3.5 py-3.5"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="mt-2.5 h-3 w-44 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
