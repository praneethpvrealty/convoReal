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
import { ENQUIRY_NOTICE_TEMPLATE_NAME } from '@/lib/whatsapp/enquiry-notice-template';
import {
  parseContactsCsv,
  extractPreferencesInBatches,
  type ParsedContactRow,
} from '@/lib/contacts/import-csv';
import { loadBatchSplit, type BatchSplit } from '@/lib/reengagement/queries';
import { canSendToEveryLead } from '@/lib/reengagement/template-gate';
import { useAuth } from '@/hooks/use-auth';

interface ReengageWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

type Step = 'template' | 'upload' | 'send' | 'done';

interface TemplateRow {
  id: string;
  status?: string | null;
  category?: string | null;
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
  const { accountId } = useAuth();
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
  const [split, setSplit] = useState<BatchSplit | null>(null);
  const [updateTemplateApproved, setUpdateTemplateApproved] = useState(false);
  const [sentSplit, setSentSplit] = useState<{
    anchored: number;
    generic: number;
  } | null>(null);
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
        .select('id, name, status, category, language, rejection_reason')
        .in('name', [
          ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
          ENQUIRY_NOTICE_TEMPLATE_NAME,
        ])
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as (TemplateRow & { name?: string })[];
      setTemplate(
        rows.find((r) => r.name === ENQUIRY_FOLLOWUP_TEMPLATE_NAME) ?? null
      );
      // The property-anchored template is optional: without it the
      // batch still goes out on the generic notice.
      // Utility, not merely APPROVED: Meta re-files a failed Utility
      // submission as Marketing, and those sends are silently dropped
      // at capped recipients. The generic notice is the safe fallback.
      setUpdateTemplateApproved(
        rows.some(
          (r) =>
            r.name === ENQUIRY_NOTICE_TEMPLATE_NAME && canSendToEveryLead(r)
        )
      );
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
    setSplit(null);
    setSentSplit(null);
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

      // An existing number is enriched rather than duplicated, so a
      // list the account already holds imports as 0 new + N updated and
      // is still a perfectly good batch to send.
      const imported = data.imported ?? 0;
      const updated = data.updated ?? 0;
      if (imported + updated === 0) {
        toast.error('No contacts were imported — check the CSV rows.');
        return;
      }
      setImportedCount(imported + updated);
      if (updated > 0) {
        toast.info(
          `${updated} of these were already in your engine — updated in place, not duplicated.`
        );
      }
      if ((data.skipped ?? 0) > 0) {
        toast.warning(
          `${data.skipped} rows skipped — contact limit on your plan.`
        );
      }
      onImported();

      // Updated contacts are re-extracted too — their notes changed,
      // and extract-preferences skips anything whose source text has not.
      const importedIds: string[] = [
        ...(Array.isArray(data.importedIds) ? data.importedIds : []),
        ...(Array.isArray(data.updatedIds) ? data.updatedIds : []),
      ];
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

      // Who can get the property-anchored message and who falls back to
      // the generic notice. Computed before the send, because a missing
      // property means an empty body param, which Meta rejects.
      try {
        setSplit(await loadBatchSplit(supabase, accountId!, tagRow.id));
      } catch {
        setSplit(null);
      }
      setStep('send');
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  }

  /** One broadcast for a slice of the batch, addressed by phone so the
   *  two templates can go to different leads within the same tag. */
  async function startBroadcast(args: {
    name: string;
    templateName: string;
    leads: { phone: string | null; name: string | null }[];
    variables: Record<string, { type: 'field' | 'static'; value: string }>;
  }): Promise<{ id: string; recipients: number } | null> {
    const csvContacts = args.leads
      .filter((l) => Boolean(l.phone))
      .map((l) => ({ phone: l.phone as string, name: l.name ?? undefined }));
    if (csvContacts.length === 0) return null;

    const res = await fetch('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: args.name,
        template: {
          name: args.templateName,
          language: template?.language ?? 'en_US',
        },
        audience: { type: 'csv', csvContacts },
        variables: args.variables,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(data?.error || 'Failed to start the broadcast');
    return {
      id: data.broadcastId,
      recipients: data.recipientsCount ?? csvContacts.length,
    };
  }

  async function handleSend() {
    if (!batchTagId) return;
    setSending(true);
    try {
      // No split available (the RPC failed) — fall back to the generic
      // notice for the whole tag rather than sending nothing.
      if (!split) {
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
        if (!res.ok)
          throw new Error(data?.error || 'Failed to start the broadcast');
        setBroadcast({
          id: data.broadcastId,
          recipients: data.recipientsCount ?? importedCount,
        });
        setStep('done');
        return;
      }

      const anchoredResult =
        split.anchored.length > 0 && updateTemplateApproved
          ? await startBroadcast({
              name: `Lead re-engagement (property-anchored) — ${batchTag}`,
              templateName: ENQUIRY_NOTICE_TEMPLATE_NAME,
              leads: split.anchored,
              // Filled per recipient by the sender from the enquired
              // property and the best match, not from contact columns.
              variables: {},
            })
          : null;

      // Everyone the anchored template cannot address — plus, when it
      // is not approved yet, the whole batch.
      const genericLeads = anchoredResult
        ? split.generic
        : [...split.anchored, ...split.generic];
      const genericResult =
        genericLeads.length > 0
          ? await startBroadcast({
              name: `Lead re-engagement — ${batchTag}`,
              templateName: ENQUIRY_FOLLOWUP_TEMPLATE_NAME,
              leads: genericLeads,
              variables: { '1': { type: 'field', value: 'name' } },
            })
          : null;

      const primary = anchoredResult ?? genericResult;
      if (!primary) {
        toast.error('No leads with a phone number to send to.');
        return;
      }
      setBroadcast({
        id: primary.id,
        recipients:
          (anchoredResult?.recipients ?? 0) + (genericResult?.recipients ?? 0),
      });
      setSentSplit({
        anchored: anchoredResult?.recipients ?? 0,
        generic: genericResult?.recipients ?? 0,
      });
      setStep('done');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to start the broadcast'
      );
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
                (template.category ?? '').toLowerCase() === 'marketing' ? (
                  // Submitted as Utility but Meta's classifier approved it
                  // as Marketing — deliverability is reduced (silent drops
                  // at capped recipients), so say it out loud.
                  <div className="space-y-1 text-sm text-amber-400">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="size-4" /> Approved, but as a
                      Marketing template
                    </div>
                    <p className="text-xs text-slate-400">
                      Meta reclassified it, so sends can be silently dropped for
                      recipients at their marketing-message limit. You can
                      continue, but reaching every lead is not guaranteed.
                    </p>
                  </div>
                ) : (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4" /> Approved and ready to
                    send
                  </div>
                )
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
              {split && updateTemplateApproved && split.anchored.length > 0 ? (
                <div className="space-y-1.5 text-xs text-slate-400">
                  <p>
                    <span className="font-semibold text-white">
                      {split.anchored.length}
                    </span>{' '}
                    lead{split.anchored.length !== 1 ? 's' : ''} get the
                    property-anchored message, naming the listing they enquired
                    about.
                  </p>
                  {split.generic.length > 0 && (
                    <p>
                      The other{' '}
                      <span className="font-semibold text-white">
                        {split.generic.length}
                      </span>{' '}
                      get the general enquiry-status notice — no linked property
                      on record.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Each lead receives the approved enquiry-status template asking
                  for their latest requirement, with buttons to update
                  preferences or close the enquiry.
                  {split &&
                    split.anchored.length > 0 &&
                    !updateTemplateApproved && (
                      <span className="text-amber-400">
                        {' '}
                        {split.anchored.length} of them could get the
                        property-anchored message instead, once that template is
                        approved as Utility — a Marketing approval is not
                        enough, because those sends are dropped for leads at
                        their marketing cap.
                      </span>
                    )}
                </p>
              )}
              <p className="text-xs text-slate-500">
                Tapping &quot;Send listings&quot; asks for matches, which opens
                the 24-hour window — so the properties go out free-form, with
                photos and full details. Replies land in your Inbox, where the
                deal-alert opt-in is asked next.
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
              {sentSplit && sentSplit.anchored > 0 && sentSplit.generic > 0
                ? ` — ${sentSplit.anchored} property-anchored, ${sentSplit.generic} general`
                : ''}
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
