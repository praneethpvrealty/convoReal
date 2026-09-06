'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InventoryImportsResponse } from '@/lib/inventory/import-activity';

export function PropertyImportsDialog({
  propertyId,
  propertyTitle,
  onClose,
}: {
  propertyId: string;
  propertyTitle: string;
  onClose: () => void;
}) {
  const { accountId } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ['inventory', 'imports', accountId, propertyId],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<InventoryImportsResponse> => {
      const response = await fetch(
        `/api/properties/${propertyId}/imports?page=${pageParam}`
      );
      if (!response.ok) throw new Error('Could not load inventory activity');
      return response.json();
    },
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: Boolean(accountId),
    staleTime: 0,
  });
  const imports = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Added to inventories</DialogTitle>
          <DialogDescription>{propertyTitle}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Agents and agencies with a direct copy of this listing. Pending review
          is shown separately from an accepted import.
        </p>
        {query.isPending && <p role="status">Loading inventory activity…</p>}
        {query.isError && (
          <div role="alert" className="space-y-2">
            <p>Could not load inventory activity.</p>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() =>
                query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch()
              }
            >
              Retry
            </Button>
          </div>
        )}
        {query.isSuccess && imports.length === 0 && (
          <p className="py-6 text-sm text-slate-400">
            No linked imports yet. Sharing a link alone does not add a property
            to another inventory.
          </p>
        )}
        <ul className="space-y-3">
          {imports.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-slate-800 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 break-words">
                  <p className="font-medium">
                    {item.agentName || item.agencyName}
                  </p>
                  {item.agentName && (
                    <p className="text-sm text-slate-400">{item.agencyName}</p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${item.status === 'In inventory' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Copy created{' '}
                {new Date(item.recordedAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </li>
          ))}
        </ul>
        {query.hasNextPage && (
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
        <p className="text-xs text-slate-500">
          Includes linked imports and automatic source-agent copies.
          Independently entered listings, onward shares, and deleted copies are
          not included.
        </p>
      </DialogContent>
    </Dialog>
  );
}
