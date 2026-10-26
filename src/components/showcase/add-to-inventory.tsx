'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderInput, Loader2, PackageCheck } from 'lucide-react';
import { appOrigin } from '@/lib/showcase/app-origin';

interface AddToInventoryProps {
  propertyId: string;
  /** The visitor already proved to be signed out on this page; skip the probe. */
  signedOut: boolean;
  onSignedOut: () => void;
}

interface Viewer {
  own: boolean;
  canImport: boolean;
  importedId: string | null;
}

type Probe = { signedOut: true } | { signedOut: false; viewer: Viewer | null };

export const SHOWCASE_IMPORT_PATH = '/api/inventory/showcase-import';

export function showcaseImportUrl(propertyId?: string): string {
  const base = `${appOrigin()}${SHOWCASE_IMPORT_PATH}`;
  return propertyId
    ? `${base}?property_id=${encodeURIComponent(propertyId)}`
    : base;
}

export function importedPropertyUrl(importedId: string): string {
  return `${appOrigin()}/inventory?propertyId=${encodeURIComponent(importedId)}`;
}

function probeKey(propertyId: string) {
  return ['showcase-import', propertyId] as const;
}

async function probeViewer(propertyId: string): Promise<Probe> {
  try {
    const res = await fetch(showcaseImportUrl(propertyId), {
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) return { signedOut: true };
    if (!res.ok) return { signedOut: false, viewer: null };
    const body = (await res.json()) as { data?: Viewer };
    return { signedOut: false, viewer: body.data ?? null };
  } catch {
    return { signedOut: true };
  }
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

export function AddToInventory({
  propertyId,
  signedOut,
  onSignedOut,
}: AddToInventoryProps) {
  const queryClient = useQueryClient();
  const { data: probe } = useQuery({
    queryKey: probeKey(propertyId),
    queryFn: () => probeViewer(propertyId),
    enabled: !signedOut,
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (probe?.signedOut) onSignedOut();
  }, [probe, onSignedOut]);

  const add = useMutation({
    mutationFn: () => importListing(propertyId),
    onSuccess: (copy) => {
      queryClient.setQueryData<Probe>(probeKey(propertyId), (current) =>
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

  if (signedOut || !probe || probe.signedOut) return null;
  const viewer = probe.viewer;
  if (!viewer || viewer.own) return null;

  if (viewer.importedId) {
    return (
      <a
        href={importedPropertyUrl(viewer.importedId)}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this listing in your inventory"
        className={`${chipClass} border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/50 hover:text-emerald-300`}
      >
        <PackageCheck className="size-3.5" />
        In your inventory
      </a>
    );
  }

  if (!viewer.canImport) return null;

  return (
    <button
      type="button"
      onClick={() => add.mutate()}
      disabled={add.isPending}
      title="Add this property to your inventory"
      aria-label="Add this property to your inventory"
      className={`${chipClass} border-primary/40 bg-primary/10 text-primary hover:border-primary/60 hover:bg-primary/20 cursor-pointer disabled:cursor-default disabled:opacity-60`}
    >
      {add.isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <FolderInput className="size-3.5" />
      )}
      Add to my inventory
    </button>
  );
}
