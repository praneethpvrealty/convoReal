'use client';

// Guided flow for re-engaging imported portal leads: a one-time
// template approval gate, then import CSV → broadcast → send in one
// dialog. Each step is also possible by hand (Settings → Templates,
// Contacts → Import, Broadcasts → New); this wizard just removes the
// navigation between them.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  buildEnquiryFollowupTemplatePayload,
  ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
} from '@/lib/whatsapp/enquiry-followup-template';
import {
  parseContactsCsv,
  extractPreferencesInBatches,
  type ParsedContactRow,
} from '@/lib/contacts/import-csv';

interface ReengageWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

type Step = 'template' | 'upload' | 'send' | 'done';

interface TemplateRow {
  id: string;
  status?: string | null;
  language?: string | null;
  rejection_reason?: string | null;
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Template' },
  { key: 'upload', label: 'Import leads' },
  { key: 'send', label: 'Send' },
];

function isApproved(status: string | null | undefined): boolean {
  return (status ?? '').toUpperCase() === 'APPROVED';
}

export function ReengageWizard({
  open,
  onOpenChange,
  onImported,
}: ReengageWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('template');
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [submittingTemplate, setSubmittingTemplate] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedContactRow[]>([]);
  const [batchTag] = useState(
    () => `Re-engage ${format(new Date(), 'd MMM HH:mm')}`
  );
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [extractProgress, setExtractProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [batchTagId, setBatchTagId] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [broadcast, setBroadcast] = useState<{
    id: string;
    recipients: number;
  } | null>(null);

  const fetchTemplate = useCallback(async () => {
    setTemplateLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('message_templates')
        .select('id, status, language, rejection_reason')
        .eq('name', ENQUIRY_FOLLOWUP_TEMPLATE_NAME)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      setTemplate(data?.[0] ?? null);
    } catch {
      toast.error('Failed to check template status');
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchTemplate();
  }, [open, fetchTemplate]);

  function reset() {
    setStep('template');
    setFile(null);
    setParsedRows([]);
    setImportedCount(0);
    setExtractProgress(null);
    setBatchTagId(null);
    setBroadcast(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmitTemplate() {
    setSubmittingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEnquiryFollowupTemplatePayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template submission failed');
      toast.success(
        'Template submitted to Meta — approval usually takes minutes to a few hours.'
      );
      await fetchTemplate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Template submission failed'
      );
    } finally {
      setSubmittingTemplate(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    const rows = parseContactsCsv(await selected.text());
    if (rows.length === 0) {
      toast.error(
        'No valid rows found. Ensure CSV has a "phone" column header.'
      );
      setParsedRows([]);
      return;
    }
    setParsedRows(rows);
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);
    try {
      // The batch tag is what the broadcast audience targets — every
      // row carries it on top of whatever tags the CSV brought.
      const rows = parsedRows.map((row) => ({
        ...row,
        tags: row.tags ? `${row.tags}, ${batchTag}` : batchTag,
      }));

      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Import failed');
        return;
      }

      const imported = data.imported ?? 0;
      if (imported === 0) {
        toast.error('No contacts were imported — check the CSV rows.');
        return;
      }
      setImportedCount(imported);
      if ((data.skipped ?? 0) > 0) {
        toast.warning(
          `${data.skipped} rows skipped — contact limit on your plan.`
        );
      }
      onImported();

      const importedIds: string[] = Array.isArray(data.importedIds)
        ? data.importedIds
        : [];
      await extractPreferencesInBatches(importedIds, (done, total) =>
        setExtractProgress({ done, total })
      );
      setExtractProgress(null);

      const supabase = createClient();
      const { data: tagRow } = await supabase
        .from('tags')
        .select('id')
        .eq('name', batchTag)
        .maybeSingle();
      if (!tagRow?.id) {
        toast.error(
          'Batch tag not found after import — send the broadcast from the Broadcasts page.'
        );
        return;
      }
      setBatchTagId(tagRow.id);
      setStep('send');
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function handleSend() {
    if (!batchTagId) return;
    setSending(true);
    try {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Lead re-engagement — ${batchTag}`,
          template: {
            name: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
            language: template?.language ?? 'en_US',
          },
          audience: { type: 'tags', tagIds: [batchTagId] },
          variables: { '1': { type: 'field', value: 'name' } },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Failed to start the broadcast');
        return;
      }
      setBroadcast({
        id: data.broadcastId,
        recipients: data.recipientsCount ?? importedCount,
      });
      setStep('done');
    } catch {
      toast.error('Failed to start the broadcast');
    } finally {
      setSending(false);
    }
  }

  const templateStatus = (template?.status ?? '').toUpperCase();
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            Re-engage portal leads
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Import old portal leads and ask each one for their latest
            requirement over WhatsApp — replies land in your Inbox and feed
            Match Radar.
          </DialogDescription>
        </DialogHeader>

        {step !== 'done' && (
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                    i < stepIndex
                      ? 'bg-primary/20 text-primary'
                      : i === stepIndex
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {i < stepIndex ? <CheckCircle className="size-3" /> : i + 1}
                </span>
                <span
                  className={`text-xs ${i === stepIndex ? 'text-slate-200' : 'text-slate-500'}`}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="h-px w-6 bg-slate-700" />
                )}
              </div>
            ))}
          </div>
        )}

        {step === 'template' && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-slate-700 p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-primary size-4" />
                <p className="text-sm font-medium text-white">
                  Enquiry follow-up template
                </p>
              </div>
              <p className="text-xs text-slate-400">
                WhatsApp requires a Meta-approved template to message leads who
                have never replied to you. This is a one-time approval — every
                future batch reuses it.
              </p>
              {templateLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="size-4 animate-spin" /> Checking status…
                </div>
              ) : !template ? (
                <Button
                  onClick={handleSubmitTemplate}
                  disabled={submittingTemplate}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {submittingTemplate && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Submit template for approval
                </Button>
              ) : isApproved(template.status) ? (
                <div className="text-primary flex items-center gap-1.5 text-sm">
                  <CheckCircle className="size-4" /> Approved and ready to send
                </div>
              ) : templateStatus === 'REJECTED' ? (
                <div className="space-y-1 text-sm text-red-400">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="size-4" /> Rejected by Meta
                  </div>
                  {template.rejection_reason && (
                    <p className="text-xs text-red-300/80">
                      {template.rejection_reason}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">
                    Review it under Settings → WhatsApp Templates before
                    retrying.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <Loader2 className="size-4 animate-spin" />
                    Waiting for Meta approval — usually minutes to a few hours.
                  </div>
                  <p className="text-xs text-slate-400">
                    You can close this and come back once it is approved.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchTemplate}
                    className="h-8 border-slate-600 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <RefreshCw className="size-3" /> Check again
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="hover:border-primary/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 p-6 transition-colors"
            >
              {file ? (
                <>
                  <FileText className="text-primary size-8" />
                  <p className="text-sm text-slate-300">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {parsedRows.length} lead{parsedRows.length !== 1 ? 's' : ''}{' '}
                    detected
                  </p>
                </>
              ) : (
                <>
                  <Upload className="size-8 text-slate-500" />
                  <p className="text-sm text-slate-400">
                    Click to upload your leads CSV
                  </p>
                  <p className="text-xs text-slate-500">
                    &quot;phone&quot; column required; name, tags, budget and
                    notes are picked up too
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {parsedRows.length > 0 && (
              <p className="text-xs text-slate-400">
                Each lead will be tagged{' '}
                <span className="inline-flex items-center rounded border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {batchTag}
                </span>{' '}
                so this batch can be targeted and tracked.
              </p>
            )}
            {extractProgress && (
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" />
                Analysing matching preferences {extractProgress.done}/
                {extractProgress.total}
              </div>
            )}
          </div>
        )}

        {step === 'send' && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-slate-700 p-4">
              <p className="text-sm font-medium text-white">
                {importedCount} lead{importedCount !== 1 ? 's' : ''} ready
              </p>
              <p className="text-xs text-slate-400">
                Each lead receives the approved follow-up template asking for
                their latest requirement, with buttons to update preferences and
                start or stop matched deal alerts. Replies open a conversation
                in your Inbox.
              </p>
            </div>
          </div>
        )}

        {step === 'done' && broadcast && (
          <div className="space-y-2 rounded-lg border border-slate-700 p-4">
            <div className="text-primary flex items-center gap-1.5 text-sm">
              <CheckCircle className="size-4" />
              Broadcast started for {broadcast.recipients} lead
              {broadcast.recipients !== 1 ? 's' : ''}
            </div>
            <p className="text-xs text-slate-400">
              Delivery, reads and replies are tracked on the broadcast page.
              Watch the Inbox for responses and Radar for fresh matches as
              preferences come in.
            </p>
            <Link
              href={`/broadcasts/${broadcast.id}`}
              className="text-primary text-sm hover:underline"
            >
              View broadcast progress →
            </Link>
          </div>
        )}

        <DialogFooter className="border-slate-700 bg-slate-900">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'template' && (
            <Button
              type="button"
              disabled={!isApproved(template?.status)}
              onClick={() => setStep('upload')}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Continue
            </Button>
          )}
          {step === 'upload' && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import {parsedRows.length > 0 ? `${parsedRows.length} Leads` : ''}
            </Button>
          )}
          {step === 'send' && (
            <Button
              type="button"
              disabled={sending}
              onClick={handleSend}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send to {importedCount} lead{importedCount !== 1 ? 's' : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
