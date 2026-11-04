'use client';

import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AgendaPdfButtonProps {
  date: Date;
}

async function agendaPdfLink(date: string): Promise<string> {
  const res = await fetch(`/api/calendar/agenda-pdf?date=${date}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not prepare the PDF');
  return body.data.url as string;
}

export function AgendaPdfButton({ date }: AgendaPdfButtonProps) {
  const download = useMutation({
    mutationFn: async () => {
      const tab = window.open('', '_blank');
      try {
        const url = await agendaPdfLink(format(date, 'yyyy-MM-dd'));
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <button
      type="button"
      onClick={() => download.mutate()}
      disabled={download.isPending}
      title={`Download the agenda for ${format(date, 'd MMM')} as PDF`}
      aria-label="Download day agenda as PDF"
      className="hover:bg-slate-850 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-60"
    >
      {download.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileDown className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">PDF</span>
    </button>
  );
}
