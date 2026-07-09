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
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ParsedRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
}

interface PreflightResult {
  canImport: boolean;
  maxImportable: number;
  totalRequested: number;
  currentCount: number;
  limit: number;
  willExceedLimit: boolean;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) return [];

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone) continue;

    rows.push({
      phone,
      name: nameIdx >= 0 ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      email: emailIdx >= 0 ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
      company:
        companyIdx >= 0 ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined : undefined,
    });
  }

  return rows;
}

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number; skipped?: number } | null>(null);
  const [limitWarning, setLimitWarning] = useState<PreflightResult | null>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setResult(null);
    setLimitWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);
    setLimitWarning(null);

    const text = await selected.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      toast.error('No valid rows found. Ensure CSV has a "phone" column header.');
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
        const data = await res.json().catch(() => ({ error: 'Failed to check import limits' }));
        toast.error(data.error || 'Failed to check import limits');
        setChecking(false);
        return;
      }

      const preflight: PreflightResult = await res.json();

      if (!preflight.canImport) {
        toast.error(`You've reached the ${preflight.limit} contact limit on your plan. Upgrade to import more.`);
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
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error || 'Import failed');
        setImporting(false);
        return;
      }

      setResult({
        imported: data.imported ?? 0,
        failed: data.failed ?? 0,
        skipped: data.skipped ?? 0,
      });

      if (data.imported > 0) {
        toast.success(`${data.imported} contact${data.imported !== 1 ? 's' : ''} imported`);
        onImported();
      }
      if (data.failed > 0) {
        toast.error(`${data.failed} contact${data.failed !== 1 ? 's' : ''} failed to import`);
      }
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Import Contacts</DialogTitle>
          <DialogDescription className="text-slate-400">
            Upload a CSV file with a &quot;phone&quot; column (required). Optional columns:
            name, email, company.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 p-6 cursor-pointer hover:border-primary/50 transition-colors"
          >
            {file ? (
              <>
                <FileText className="size-8 text-primary" />
                <p className="text-sm text-slate-300">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} detected
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
            <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-200">
                    Contact limit will be exceeded
                  </p>
                  <p className="text-xs text-amber-300/80">
                    Your plan allows {limitWarning.limit} contacts. You currently
                    have {limitWarning.currentCount}. Importing all {limitWarning.totalRequested} contacts
                    would exceed your limit.
                  </p>
                  <p className="text-sm text-white font-medium mt-2">
                    Do you want to import the first {limitWarning.maxImportable} contacts?
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLimitWarning(null)}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800 h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={doImport}
                  disabled={importing}
                  className="bg-amber-600 hover:bg-amber-700 text-white h-8 text-xs"
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
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Preview (first {preview.length} rows)
              </p>
              <div className="rounded-lg border border-slate-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800">
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Phone</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Name</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Email</th>
                      <th className="px-3 py-1.5 text-left text-slate-400 font-medium">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-slate-700/50">
                        <td className="px-3 py-1.5 text-slate-300">{row.phone}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.name || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.email || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{row.company || '-'}</td>
                      </tr>
                    ))}
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
            <div className="rounded-lg border border-slate-700 p-4 space-y-2">
              <p className="text-sm font-medium text-white">Import Complete</p>
              <div className="flex items-center gap-4 flex-wrap">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-primary text-sm">
                    <CheckCircle className="size-4" />
                    {result.imported} imported
                  </div>
                )}
                {(result.failed ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-red-400 text-sm">
                    <XCircle className="size-4" />
                    {result.failed} failed
                  </div>
                )}
                {(result.skipped ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 text-amber-400 text-sm">
                    <AlertTriangle className="size-4" />
                    {result.skipped} skipped (plan limit)
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-slate-900 border-slate-700">
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
              {(importing || checking) && <Loader2 className="size-4 animate-spin" />}
              Import {parsedRows.length > 0 ? `${parsedRows.length} Contacts` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
