'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Zap } from 'lucide-react';
import { CONTACT_LIST_COLUMNS } from '@/lib/contacts/list-columns';
import { formatInrCompact } from '@/lib/format/currency';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import { createClient } from '@/lib/supabase/client';
import type { Contact } from '@/types';

interface ContactPeekLineProps {
  contactId: string;
}

function budgetRange(
  min: number | null | undefined,
  max: number | null | undefined,
  noBudget: boolean | null | undefined
): string | null {
  if (noBudget) return 'No budget limit';
  if (min && max) return `${formatInrCompact(min)} – ${formatInrCompact(max)}`;
  if (max) return `Up to ${formatInrCompact(max)}`;
  if (min) return `${formatInrCompact(min)}+`;
  return null;
}

export function ContactPeekLine({ contactId }: ContactPeekLineProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['contact-peek', contactId],
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createClient();
      const [contactResult, tagResult] = await Promise.all([
        supabase
          .from('contacts')
          .select(CONTACT_LIST_COLUMNS)
          .eq('id', contactId)
          .single(),
        supabase
          .from('contact_tags')
          .select('tag:tags(name)')
          .eq('contact_id', contactId),
      ]);
      if (contactResult.error) throw contactResult.error;
      const tags = (
        (tagResult.data ?? []) as {
          tag: { name: string } | { name: string }[] | null;
        }[]
      )
        .map((row) => (Array.isArray(row.tag) ? row.tag[0] : row.tag)?.name)
        .filter((name): name is string => Boolean(name));
      return { contact: contactResult.data as unknown as Contact, tags };
    },
  });

  if (isLoading) {
    return <p className="text-[10px] text-slate-500">Loading preview…</p>;
  }
  if (!data) return null;

  const { contact, tags } = data;
  const source = resolveRequirementSource(contact);
  const budget = budgetRange(
    source.min_budget ?? source.pref_budget_min,
    source.max_budget ?? source.pref_budget_max,
    source.no_budget
  );
  const areas = Array.from(
    new Set([...(source.areas_of_interest ?? []), ...(source.pref_areas ?? [])])
  );
  const headline =
    [budget ? `Budget ${budget}` : null, contact.company, contact.email]
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ') || 'No preferences captured yet';
  const detail = [
    areas.length ? areas.slice(0, 2).join(', ') : null,
    ...tags.slice(0, 3),
    contact.last_contacted_at
      ? `Last ${formatDistanceToNow(new Date(contact.last_contacted_at), { addSuffix: true })}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="border-primary/40 bg-primary/5 flex items-start gap-2 rounded-lg border px-2.5 py-1.5">
      <Zap className="text-primary mt-0.5 size-3 shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-slate-200">
          {headline}
        </p>
        {detail && (
          <p className="truncate text-[10px] text-slate-400">{detail}</p>
        )}
      </div>
    </div>
  );
}
