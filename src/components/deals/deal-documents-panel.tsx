'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  DEAL_DOCUMENT_CATEGORIES,
  type DealDocument,
  type DealDocumentCategory,
  type ExtractedDocumentFields,
} from '@/lib/invoices/types';

const EXTRACT_COST = AI_FEATURE_COSTS.deal_document_extract;

/** Only a PDF or a photo can be read; HEIC uploads fine but Gemini
 *  cannot read it, so the button is hidden rather than failing. */
const READABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  address_lines: 'Address',
  state_name: 'State',
  pincode: 'PIN code',
  pan: 'PAN',
  aadhaar_last4: 'Aadhaar (last 4)',
  father_or_spouse_name: 'Father / spouse',
  date_of_birth: 'Date of birth',
  parties: 'Parties',
  survey_number: 'Survey no.',
  khata_number: 'Khata no.',
  extent: 'Extent',
  document_number: 'Document no.',
  document_date: 'Document date',
  consideration: 'Consideration',
  notes: 'Notes',
  document_type: 'Document type',
};

interface DealDocumentsPanelProps {
  dealId: string;
  canEdit: boolean;
}

export function DealDocumentsPanel({
  dealId,
  canEdit,
}: DealDocumentsPanelProps) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DealDocumentCategory>('identity');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openExtraction, setOpenExtraction] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['deal-documents', dealId],
    queryFn: async (): Promise<DealDocument[]> => {
      const response = await fetch(`/api/deals/${dealId}/documents`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load documents');
      return json.data ?? [];
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] });

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category);
      form.append('title', file.name);

      const response = await fetch(`/api/deals/${dealId}/documents`, {
        method: 'POST',
        body: form,
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Upload failed');
      await refresh();
      toast.success(`${file.name} added to the deal folder.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function extract(doc: DealDocument) {
    setBusyId(doc.id);
    try {
      const response = await fetch(
        `/api/deals/${dealId}/documents/${doc.id}/extract`,
        { method: 'POST' }
      );
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not read the document');
      await refresh();
      setOpenExtraction(doc.id);
      toast.success('Read. Check each field before using it.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not read the document'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(doc: DealDocument) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`))
      return;
    setBusyId(doc.id);
    try {
      const response = await fetch(`/api/deals/${dealId}/documents/${doc.id}`, {
        method: 'DELETE',
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Could not delete');
      await refresh();
      toast.success('Document deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Deal documents</h3>
        <p className="text-xs text-slate-400">
          Aadhaars, agreement drafts, old sale deeds. Stored privately — every
          view goes through a signed link that expires.
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="doc-category">Category</Label>
            <select
              id="doc-category"
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as DealDocumentCategory)
              }
            >
              {DEAL_DOCUMENT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".pdf,image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-medium text-slate-300">
            Nothing filed against this deal yet
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{doc.title}</p>
                  <p className="text-xs text-slate-500">
                    {DEAL_DOCUMENT_CATEGORIES.find(
                      (c) => c.value === doc.category
                    )?.label ?? doc.category}
                    {doc.size_bytes
                      ? ` · ${Math.max(1, Math.round(doc.size_bytes / 1024))} KB`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/deals/${dealId}/documents/${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button size="sm" variant="outline">
                      <ExternalLink className="h-4 w-4" />
                      Open
                    </Button>
                  </a>
                  {canEdit && READABLE.includes(doc.mime_type ?? '') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => extract(doc)}
                      disabled={busyId === doc.id}
                      title={`Reads the document with AI — ${EXTRACT_COST} credits`}
                    >
                      {busyId === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {doc.extracted ? 'Read again' : 'Read with AI'}
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(doc)}
                      disabled={busyId === doc.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {doc.extraction_status === 'failed' && (
                <p className="mt-2 text-xs text-rose-300">
                  Could not read this one. Your credits were refunded.
                </p>
              )}

              {doc.extracted && (
                <div className="mt-3 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    className="text-primary text-xs font-semibold"
                    onClick={() =>
                      setOpenExtraction(
                        openExtraction === doc.id ? null : doc.id
                      )
                    }
                  >
                    {openExtraction === doc.id ? 'Hide' : 'Show'} what the AI
                    read
                  </button>

                  {openExtraction === doc.id && (
                    <ExtractionReview extracted={doc.extracted} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The AI's read-out, shown as a proposal.
 *
 * Copy buttons rather than an Apply that writes: the agent is the one
 * who decides what goes on a legal document, and a field they pasted
 * deliberately is a field they have looked at.
 */
function ExtractionReview({
  extracted,
}: {
  extracted: ExtractedDocumentFields;
}) {
  const entries = Object.entries(extracted).filter(
    ([, value]) =>
      value !== undefined &&
      value !== null &&
      (Array.isArray(value) ? value.length > 0 : String(value).length > 0)
  );

  if (!entries.length) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        Nothing could be read from this document.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] text-amber-300/80">
        Check every value against the document before using it on an invoice.
      </p>
      <dl className="grid gap-1.5">
        {entries.map(([key, value]) => {
          const text = Array.isArray(value) ? value.join('\n') : String(value);
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-3 rounded-md bg-slate-950/50 px-3 py-2"
            >
              <div className="min-w-0">
                <dt className="text-[10px] tracking-wide text-slate-500 uppercase">
                  {FIELD_LABELS[key] ?? key}
                </dt>
                <dd className="text-xs break-words whitespace-pre-wrap text-slate-200">
                  {text}
                </dd>
              </div>
              <button
                type="button"
                className="text-primary shrink-0 text-[11px] font-semibold"
                onClick={() => {
                  void navigator.clipboard.writeText(text);
                  toast.success('Copied');
                }}
              >
                Copy
              </button>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
