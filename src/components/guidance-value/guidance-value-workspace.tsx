'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useCan } from '@/hooks/use-can';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  rateHeadline,
  rateLocation,
  scheduleHeadline,
} from '@/lib/guidance-value/present';
import type {
  GuidanceRate,
  SavedGuidanceValue,
} from '@/lib/guidance-value/types';
import { formatInr } from '@/lib/guidance-value/units';
import { createClient } from '@/lib/supabase/client';

import { GuidanceValueTool } from './guidance-value-tool';

interface GuidanceValueWorkspaceProps {
  propertyId?: string | null;
  dealId?: string | null;
}

interface SubjectInfo {
  label: string;
  title: string;
}

function hasRate(
  snapshot: Partial<GuidanceRate>
): snapshot is Pick<GuidanceRate, 'rate' | 'unit' | 'property_class'> &
  Partial<GuidanceRate> {
  return Boolean(snapshot.rate && snapshot.unit && snapshot.property_class);
}

export function GuidanceValueWorkspace({
  propertyId,
  dealId,
}: GuidanceValueWorkspaceProps) {
  const queryClient = useQueryClient();
  const readOnly = useCan('view-only');
  const subjectKey = dealId
    ? `deal_id=${dealId}`
    : propertyId
      ? `property_id=${propertyId}`
      : null;

  const { data: subject } = useQuery({
    queryKey: ['guidance-value-subject', subjectKey],
    enabled: Boolean(subjectKey),
    queryFn: async (): Promise<SubjectInfo | null> => {
      const supabase = createClient();
      if (dealId) {
        const { data } = await supabase
          .from('deals')
          .select('title')
          .eq('id', dealId)
          .maybeSingle();
        return data
          ? { label: 'Transaction', title: data.title as string }
          : null;
      }
      const { data } = await supabase
        .from('properties')
        .select('title')
        .eq('id', propertyId as string)
        .maybeSingle();
      return data ? { label: 'Property', title: data.title as string } : null;
    },
  });

  const { data: saved = [] } = useQuery({
    queryKey: ['guidance-values-saved', subjectKey],
    enabled: Boolean(subjectKey),
    queryFn: async (): Promise<SavedGuidanceValue[]> => {
      const res = await fetch(`/api/guidance-value/saved?${subjectKey}`);
      if (!res.ok) throw new Error('Could not load saved guidance values');
      return (await res.json()).data;
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['guidance-values-saved', subjectKey],
    });

  const remove = async (id: string) => {
    const res = await fetch(`/api/guidance-value/saved/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error('Could not delete');
      return;
    }
    await refresh();
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black">
          <Landmark className="h-6 w-6" />
          Guidance value
        </h1>
        <p className="text-muted-foreground text-sm">
          Upload the schedule of a Karnataka sale deed to find the government
          guidance value from the published notification.
        </p>
        {subject && (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{subject.label}: </span>
            <span className="font-semibold">{subject.title}</span>
          </p>
        )}
      </div>

      {saved.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-semibold uppercase">
            Saved
          </p>
          {saved.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-xl border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {formatInr(Number(row.total_value))}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {scheduleHeadline(row.schedule)}
                </p>
                {hasRate(row.rate_snapshot) && (
                  <p className="text-muted-foreground text-xs">
                    {rateLocation({
                      locality: row.rate_snapshot.locality ?? null,
                      road: row.rate_snapshot.road ?? null,
                      village: row.rate_snapshot.village ?? null,
                      hobli: row.rate_snapshot.hobli ?? null,
                      taluk: row.rate_snapshot.taluk ?? null,
                    })}{' '}
                    · {rateHeadline(row.rate_snapshot)} ·{' '}
                    {new Date(row.created_at).toLocaleDateString('en-IN')}
                  </p>
                )}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(row.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <GuidanceValueTool
        creditCost={AI_FEATURE_COSTS.guidance_value_lookup}
        propertyId={propertyId}
        dealId={dealId}
        canSave={!readOnly}
        onSaved={refresh}
      />
    </div>
  );
}
