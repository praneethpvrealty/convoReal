'use client';

import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderInput, Loader2, PackageCheck } from 'lucide-react';
import { appOrigin } from '@/lib/showcase/app-origin';
import { cn } from '@/lib/utils';

interface AddToInventoryProps {
  propertyId: string;
  /** The visitor already proved to be signed out on this page; skip the probe. */
  signedOut: boolean;
  onSignedOut: () => void;
  /** `chip` beside the open listing's Share; `icon` in a grid card's actions. */
  variant?: 'chip' | 'icon';
  /** Names the listing in the icon's accessible label. */
  title?: string;
  /** Ask about this listing on its own. Off where the page-level
   *  useShowcaseImportViewers already covers it. */
  probe?: boolean;
}

interface Viewer {
  own: boolean;
  canImport: boolean;
  importedId: string | null;
}

type Probe = { signedOut: true } | { signedOut: false; viewer: Viewer | null };

type Viewers =
  { signedOut: true } | { signedOut: false; viewers: Record<string, Viewer> };

export const SHOWCASE_IMPORT_PATH = '/api/inventory/showcase-import';

/** Matches MAX_VIEWER_LOOKUP on the route. */
export const VIEWER_BATCH_SIZE = 60;

export function showcaseImportUrl(propertyIds?: string[]): string {
  const base = `${appOrigin()}${SHOWCASE_IMPORT_PATH}`;
  return propertyIds && propertyIds.length > 0
    ? `${base}?property_ids=${propertyIds.map(encodeURIComponent).join(',')}`
    : base;
}

export function importedPropertyUrl(importedId: string): string {
  return `${appOrigin()}/inventory?propertyId=${encodeURIComponent(importedId)}`;
}

function probeKey(propertyId: string) {
  return ['showcase-import', propertyId] as const;
}

async function fetchViewers(
  propertyIds: string[],
  onBatch?: (ids: string[], viewers: Record<string, Viewer>) => void
): Promise<Viewers> {
  const viewers: Record<string, Viewer> = {};
  let failure: unknown = null;
  for (let i = 0; i < propertyIds.length; i += VIEWER_BATCH_SIZE) {
    const batch = propertyIds.slice(i, i + VIEWER_BATCH_SIZE);
    let res: Response;
    try {
      res = await fetch(showcaseImportUrl(batch), { credentials: 'include' });
    } catch (err) {
      failure = err;
      continue;
    }
    if (res.status === 401 || res.status === 403) return { signedOut: true };
    if (!res.ok) {
      failure = new Error(`Probe failed with ${res.status}`);
      continue;
    }
    const body = (await res.json()) as {
      data?: { viewers?: Record<string, Viewer> };
    };
    const answered = body.data?.viewers ?? {};
    Object.assign(viewers, answered);
    onBatch?.(batch, answered);
  }
  if (failure) throw failure;
  return { signedOut: false, viewers };
}

async function probeViewer(propertyId: string): Promise<Probe> {
  const result = await fetchViewers([propertyId]);
  if (result.signedOut) return result;
  return { signedOut: false, viewer: result.viewers[propertyId] ?? null };
}

/**
 * One probe for every listing the page holds, seeding each listing's
 * cache entry so the grid cards and the open listing read it without a
 * request of their own. Each batch's listings are seeded as soon as it
 * answers, and a batch that fails neither discards nor stops the others;
 * a retry asks again only about listings still unanswered.
 * A signed-out visitor costs a single request: the first answer that
 * says so stops the rest. The entries live as long as
 * the page, because nothing asks again for a listing whose card was
 * filtered out and later comes back.
 */
export function useShowcaseImportViewers(
  propertyIds: string[],
  signedOut: boolean,
  onSignedOut: () => void
) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => [...new Set(propertyIds)].sort(), [propertyIds]);
  const { data } = useQuery({
    queryKey: ['showcase-import-batch', ids.join(',')],
    queryFn: async () => {
      queryClient.setQueryDefaults(['showcase-import'], {
        gcTime: Infinity,
        staleTime: Infinity,
      });
      const unanswered = ids.filter(
        (id) => queryClient.getQueryData(probeKey(id)) === undefined
      );
      const result = await fetchViewers(unanswered, (batch, viewers) => {
        for (const id of batch) {
          if (queryClient.getQueryData(probeKey(id)) === undefined) {
            const entry: Probe = {
              signedOut: false,
              viewer: viewers[id] ?? null,
            };
            queryClient.setQueryData(probeKey(id), entry);
          }
        }
      });
      return result.signedOut;
    },
    enabled: !signedOut && ids.length > 0,
    retry: 2,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (data === true) onSignedOut();
  }, [data, onSignedOut]);
}

async function importListing(
  propertyId: string
): Promise<{ id: string; alreadyImported?: boolean }> {
  const res = await fetch(showcaseImportUrl(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ property_id: propertyId }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { id: string; alreadyImported?: boolean };
    error?: string;
  } | null;
  if (!res.ok || !body?.data) {
    throw new Error(body?.error || 'Failed to add this property');
  }
  return body.data;
}

const chipClass =
  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors';
const iconClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-md transition-all hover:scale-105';

export function AddToInventory({
  propertyId,
  signedOut,
  onSignedOut,
  variant = 'chip',
  title,
  probe = true,
}: AddToInventoryProps) {
  const queryClient = useQueryClient();
  const { data: viewerProbe } = useQuery({
    queryKey: probeKey(propertyId),
    queryFn: () => probeViewer(propertyId),
    enabled: !signedOut && probe,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (viewerProbe?.signedOut) onSignedOut();
  }, [viewerProbe, onSignedOut]);

  const add = useMutation({
    mutationFn: (id: string) => importListing(id),
    onSuccess: (copy, id) => {
      queryClient.setQueryData<Probe>(probeKey(id), (current) =>
        current && !current.signedOut && current.viewer
          ? {
              signedOut: false,
              viewer: { ...current.viewer, importedId: copy.id },
            }
          : current
      );
      toast.success(
        copy.alreadyImported
          ? 'This property is already in your inventory'
          : 'Added to your inventory — review and publish it when ready'
      );
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to add this property'
      );
    },
  });

  if (signedOut || !viewerProbe || viewerProbe.signedOut) return null;
  const viewer = viewerProbe.viewer;
  if (!viewer || viewer.own) return null;
  const icon = variant === 'icon';

  if (viewer.importedId) {
    return (
      <a
        href={importedPropertyUrl(viewer.importedId)}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this listing in your inventory"
        aria-label={
          icon ? `${title ?? 'This listing'} is in your inventory` : undefined
        }
        className={cn(
          icon ? iconClass : chipClass,
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/50 hover:text-emerald-300'
        )}
      >
        <PackageCheck className={icon ? 'size-4' : 'size-3.5'} />
        {!icon && 'In your inventory'}
      </a>
    );
  }

  if (!viewer.canImport) return null;
  const importing = add.isPending && add.variables === propertyId;

  return (
    <button
      type="button"
      onClick={() => add.mutate(propertyId)}
      disabled={importing}
      title="Add to my inventory"
      aria-label={
        icon
          ? `Add ${title ?? 'this listing'} to my inventory`
          : 'Add this property to your inventory'
      }
      className={cn(
        icon ? iconClass : chipClass,
        'border-primary/40 bg-primary/10 text-primary hover:border-primary/60 hover:bg-primary/20 cursor-pointer disabled:cursor-default disabled:opacity-60'
      )}
    >
      {importing ? (
        <Loader2 className={cn(icon ? 'size-4' : 'size-3.5', 'animate-spin')} />
      ) : (
        <FolderInput className={icon ? 'size-4' : 'size-3.5'} />
      )}
      {!icon && 'Add to my inventory'}
    </button>
  );
}
