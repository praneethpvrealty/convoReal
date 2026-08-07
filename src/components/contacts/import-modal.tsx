'use client';

import { useState, useRef } from 'react';
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
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  parseContactsCsv,
  extractPreferencesInBatches,
  importContactsInChunks,
  type ParsedContactRow,
} from '@/lib/contacts/import-csv';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface PreflightResult {
  canImport: boolean;
  maxImportable: number;
  totalRequested: number;
  currentCount: number;
  limit: number;
  willExceedLimit: boolean;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedContactRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    updated: number;
    failed: number;
    skipped?: number;
    propertiesLinked: number;
    propertiesUnresolved: number;
  } | null>(null);
  const [limitWarning, setLimitWarning] = useState<PreflightResult | null>(
    null
  );
  const [extractProgress, setExtractProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setResult(null);
    setLimitWarning(null);
    setExtractProgress(null);
    setImportProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  function handleDownloadSample() {
    const headers =
      'phone,name,name_tag,email,company,tags,areas_of_interest,min_budget,max_budget,preferences\n';
    const sampleRow1 =
      '+919876543210,John Doe,Bank DSA,john@example.com,Acme Corp,"Hot, Buyer",Whitefield,10000000,15000000,Looking for a 3 BHK premium apartment in Whitefield\n';
    const sampleRow2 =
      '+918765432109,Jane Smith,,jane@example.com,Global Realty,"Warm, Agent",HSR Layout,20000000,25000000,Has clients looking for villas in HSR Layout\n';
    const csvContent = headers + sampleRow1 + sampleRow2;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'convoreal_contacts_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);
    setLimitWarning(null);

    const text = await selected.text();
    const rows = parseContactsCsv(text);

    if (rows.length === 0) {
      toast.error(
        'No valid rows found. Ensure CSV has a "phone" column header.'
      );
      setParsedRows([]);
      return;
    }

    setParsedRows(rows);
  }

  // Phase 1: Preflight check — ask the server how many we can import
  async function handleImportClick() {
    if (parsedRows.length === 0) return;
    setChecking(true);

    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows, preflight: true }),
      });

      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: 'Failed to check import limits' }));
        toast.error(data.error || 'Failed to check import limits');
        setChecking(false);
        return;
      }

      const preflight: PreflightResult = await res.json();

      if (!preflight.canImport) {
        toast.error(
          `You've reached the ${preflight.limit} contact limit on your plan. Upgrade to import more.`
        );
        setChecking(false);
        return;
      }

      if (preflight.willExceedLimit) {
        // Show the warning dialog — user must confirm
        setLimitWarning(preflight);
        setChecking(false);
        return;
      }

      // No limit issue — proceed directly
      setChecking(false);
      await doImport();
    } catch {
      toast.error('Failed to check import limits');
      setChecking(false);
    }
  }

  // Phase 2: Actually import
  async function doImport() {
    setImporting(true);
    setLimitWarning(null);

    try {
      // Chunked: the route writes several rows-worth of queries per
      // contact, so a few hundred rows in one request would outlast the
      // serverless limit.
      const data = await importContactsInChunks(parsedRows, (done, total) =>
        setImportProgress({ done, total })
      );
      setImportProgress(null);

      setResult({
        imported: data.imported,
        updated: data.updated,
        failed: data.failed,
        skipped: data.skipped,
        propertiesLinked: data.propertiesLinked,
        propertiesUnresolved: data.propertiesUnresolved,
      });

      if (data.imported > 0 || data.updated > 0) {
        const parts: string[] = [];
        if (data.imported > 0) {
          parts.push(
            `${data.imported} contact${data.imported !== 1 ? 's' : ''} imported`
          );
        }
        // Numbers already on file are enriched rather than duplicated.
        if (data.updated > 0) {
          parts.push(`${data.updated} existing updated`);
        }
        toast.success(parts.join(', '));
        onImported();
      }
      if (data.failed > 0) {
        toast.error(
          `${data.failed} contact${data.failed !== 1 ? 's' : ''} failed to import`
        );
      }

      // Updated contacts get re-extracted too: their notes changed, and
      // extract-preferences skips anything whose source text has not.
      const contactIds = [...data.importedIds, ...data.updatedIds];
      if (contactIds.length > 0) {
        void extractPreferencesInBatches(contactIds, (done, total) =>
          setExtractProgress({ done, total })
        ).then(() => {
          setExtractProgress(null);
          toast.success('Matching preferences analysed');
          onImported();
        });
      }
    } catch (err) {
      setImportProgress(null);
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Import Contacts</DialogTitle>
          <DialogDescription className="text-slate-400">
            Upload a CSV file with a &quot;phone&quot; column (required).
            Optional columns: name, name_tag, email, company. Trailing
            qualifiers in names (e.g. &quot;Nataraj Bank DSA&quot;) are
            auto-split into the Engine-only Name Tag.{' '}
            <button
              type="button"
              onClick={handleDownloadSample}
              className="text-primary font-semibold hover:underline"
            >
              Download sample template
            </button>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="hover:border-primary/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 p-6 transition-colors"
          >
            {file ? (
              <>
                <FileText className="text-primary size-8" />
                <p className="text-sm text-slate-300">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''}{' '}
                  detected
                </p>
              </>
            ) : (
              <>
                <Upload className="size-8 text-slate-500" />
                <p className="text-sm text-slate-400">
                  Click to upload CSV file
                </p>
                <p className="text-xs text-slate-500">
                  CSV with &quot;phone&quot; column required
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

          {/* Limit warning dialog */}
          {limitWarning && (
            <div className="space-y-3 rounded-lg border border-amber-600/50 bg-amber-950/30 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-200">
                    Contact limit will be exceeded
                  </p>
                  <p className="text-xs text-amber-300/80">
                    Your plan allows {limitWarning.limit} contacts. You
                    currently have {limitWarning.currentCount}. Importing all{' '}
                    {limitWarning.totalRequested} contacts would exceed your
                    limit.
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    Do you want to import the first {limitWarning.maxImportable}{' '}
                    contacts?
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLimitWarning(null)}
                  className="h-8 border-slate-600 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={doImport}
                  disabled={importing}
                  className="h-8 bg-amber-600 text-xs text-white hover:bg-amber-700"
                >
                  {importing && <Loader2 className="size-3 animate-spin" />}
                  Import {limitWarning.maxImportable} Contacts
                </Button>
              </div>
            </div>
          )}

          {/* Preview table */}
          {preview.length > 0 && !result && !limitWarning && (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wider text-slate-400 uppercase">
                Preview (first {preview.length} rows)
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-700">
                <table className="w-full min-w-[700px] text-xs">
                  <thead>
                    <tr className="bg-slate-800">
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Phone
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Name
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Name Tag
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Tags
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Areas
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Budget
                      </th>
                      <th className="px-3 py-1.5 text-left font-medium text-slate-400">
                        Preferences
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => {
                      const budgetLabel =
                        row.min_budget || row.max_budget
                          ? `${row.min_budget ? `₹${(row.min_budget / 100000).toFixed(0)}L` : '0'} - ${row.max_budget ? `₹${(row.max_budget / 100000).toFixed(0)}L` : 'Any'}`
                          : '-';
                      return (
                        <tr key={i} className="border-t border-slate-700/50">
                          <td className="px-3 py-1.5 text-slate-300">
                            {row.phone}
                          </td>
                          <td className="px-3 py-1.5 font-medium text-slate-300">
                            {row.name || '-'}
                          </td>
                          <td className="px-3 py-1.5">
                            {row.name_tag ? (
                              <span className="inline-flex items-center rounded border border-slate-600/50 bg-slate-700/40 px-1.5 py-0.5 text-[10px] text-slate-300">
                                {row.name_tag}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-slate-400">
                            {row.tags || '-'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">
                            {row.areas_of_interest || '-'}
                          </td>
                          <td className="text-slate-350 px-3 py-1.5">
                            {budgetLabel}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-1.5 text-slate-400">
                            {row.notes || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 5 && (
                <p className="text-xs text-slate-500">
                  ...and {parsedRows.length - 5} more rows
                </p>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-2 rounded-lg border border-slate-700 p-4">
              <p className="text-sm font-medium text-white">Import Complete</p>
              <div className="flex flex-wrap items-center gap-4">
                {result.imported > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4" />
                    {result.imported} imported
                  </div>
                )}
                {(result.failed ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4" />
                    {result.failed} failed
                  </div>
                )}
                {result.updated > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-blue-400">
                    <CheckCircle className="size-4" />
                    {result.updated} existing updated
                  </div>
                )}
                {(result.skipped ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4" />
                    {result.skipped} skipped (plan limit)
                  </div>
                )}
              </div>
              {importProgress && (
                <div className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Loader2 className="size-4 animate-spin" />
                  Importing {importProgress.done}/{importProgress.total}
                </div>
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
        </div>

        <DialogFooter className="border-slate-700 bg-slate-900">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && !limitWarning && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing || checking}
              onClick={handleImportClick}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {(importing || checking) && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Import{' '}
              {parsedRows.length > 0 ? `${parsedRows.length} Contacts` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
