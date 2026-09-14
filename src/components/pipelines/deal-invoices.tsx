'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  INVOICE_MIME_TYPES,
  INVOICE_SIZE_LIMIT,
  type DealInvoiceLink,
} from '@/lib/pipelines/deal-invoices';

interface DealInvoicesProps {
  dealId: string;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DealInvoices({ dealId }: DealInvoicesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<DealInvoiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/invoices`);
      const json = await res.json().catch(() => null);
      if (res.ok) setInvoices(json?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFile(file: File) {
    if (file.size > INVOICE_SIZE_LIMIT) {
      toast.error(
        `Invoices can be up to ${Math.round(INVOICE_SIZE_LIMIT / (1024 * 1024))} MB.`
      );
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/deals/${dealId}/invoices`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || 'Could not upload the invoice');
        return;
      }
      setInvoices(json?.data ?? []);
      toast.success('Invoice attached');
    } catch {
      toast.error('Could not upload the invoice');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(path: string) {
    setRemoving(path);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/invoices?path=${encodeURIComponent(path)}`,
        { method: 'DELETE' }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error || 'Could not remove the invoice');
        return;
      }
      setInvoices(json?.data ?? []);
      toast.success('Invoice removed');
    } catch {
      toast.error('Could not remove the invoice');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="grid gap-2">
      <Label className="text-slate-300">Invoices</Label>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
      ) : invoices.length === 0 ? (
        <p className="text-xs text-slate-500">
          No invoice attached yet. Add the brokerage invoice or its receipt.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {invoices.map((invoice) => (
            <li
              key={invoice.path}
              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
            >
              <FileText className="text-primary h-4 w-4 shrink-0" />
              {invoice.url ? (
                <a
                  href={invoice.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-xs text-slate-200 hover:underline"
                >
                  {invoice.name}
                </a>
              ) : (
                <span className="flex-1 truncate text-xs text-slate-400">
                  {invoice.name}
                </span>
              )}
              {invoice.size > 0 && (
                <span className="shrink-0 text-[11px] text-slate-500">
                  {formatSize(invoice.size)}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleRemove(invoice.path)}
                disabled={removing === invoice.path}
                aria-label={`Remove ${invoice.name}`}
                className="shrink-0 text-slate-500 hover:text-red-400 disabled:opacity-50"
              >
                {removing === invoice.path ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={INVOICE_MIME_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center justify-center gap-1.5 self-start rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Paperclip className="h-3.5 w-3.5" />
        )}
        {uploading ? 'Uploading...' : 'Upload invoice'}
      </button>
    </div>
  );
}
