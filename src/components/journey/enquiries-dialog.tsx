'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Home, UserRound } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  JOURNEY_ENQUIRY_SELECT,
  journeyEnquiryEntries,
  type JourneyEnquiryRow,
  type JourneyMode,
} from './shared';

interface EnquiriesDialogProps {
  mode: JourneyMode;
  subjectId: string | null;
  title: string;
  onOpenChange: (open: boolean) => void;
}

export function EnquiriesDialog({
  mode,
  subjectId,
  title,
  onOpenChange,
}: EnquiriesDialogProps) {
  const { accountId } = useAuth();
  const enquiriesQuery = useQuery({
    queryKey: ['journey-subject-enquiries', accountId, mode, subjectId],
    enabled: Boolean(accountId && subjectId),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('contact_property_inquiries')
        .select(JOURNEY_ENQUIRY_SELECT)
        .eq('account_id', accountId!)
        .eq(mode === 'buyer' ? 'contact_id' : 'property_id', subjectId!);
      if (error) throw error;
      return journeyEnquiryEntries(
        (data ?? []) as unknown as JourneyEnquiryRow[],
        mode
      );
    },
  });
  const entries = enquiriesQuery.data ?? [];

  return (
    <Dialog open={Boolean(subjectId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-slate-800 bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            {mode === 'buyer' ? 'Enquired properties' : 'Enquiring buyers'}
          </DialogTitle>
        </DialogHeader>
        <p className="-mt-1 truncate text-xs text-slate-400">{title}</p>

        <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
          {enquiriesQuery.isLoading ? (
            <p className="py-8 text-center text-xs text-slate-500">
              Loading enquiries…
            </p>
          ) : enquiriesQuery.error ? (
            <p className="py-8 text-center text-xs text-red-400">
              Could not load enquiries: {enquiriesQuery.error.message}
            </p>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              No enquiries recorded.
            </p>
          ) : (
            entries.map((entry) => {
              const meta = [
                entry.subtitle,
                entry.source,
                entry.enquiredAt
                  ? format(new Date(entry.enquiredAt), 'd MMM yyyy')
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const body = (
                <>
                  {mode === 'buyer' ? (
                    <Home className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <UserRound className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {entry.title}
                    </span>
                    {meta && (
                      <span className="block truncate text-[11px] text-slate-500">
                        {meta}
                      </span>
                    )}
                  </span>
                </>
              );
              const rowClass =
                'flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2';
              return entry.targetId ? (
                <Link
                  key={entry.id}
                  href={
                    mode === 'buyer'
                      ? `/inventory?propertyId=${entry.targetId}`
                      : `/contacts?contactId=${entry.targetId}`
                  }
                  className={`${rowClass} hover:border-slate-700 hover:bg-slate-900`}
                >
                  {body}
                </Link>
              ) : (
                <div key={entry.id} className={rowClass}>
                  {body}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
