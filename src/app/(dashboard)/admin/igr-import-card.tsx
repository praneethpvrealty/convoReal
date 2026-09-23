'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Globe, Loader2, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IGR_GUIDANCE_PAGE } from '@/lib/guidance-value/import-url';

interface IgrImportCardProps {
  parse: (sourceId: string) => Promise<boolean>;
  stop: () => void;
  onImported: () => void;
}

interface FoundPdf {
  url: string;
  label: string;
  district: string | null;
  registration_district?: string;
  sro?: string;
  kind: 'notification' | 'corrigendum';
  imported: boolean;
}

type RowState = 'queued' | 'downloading' | 'parsing' | 'done' | 'failed';

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `Request failed (${res.status})`;
}

export function IgrImportCard({ parse, stop, onImported }: IgrImportCardProps) {
  const [url, setUrl] = useState(IGR_GUIDANCE_PAGE);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<FoundPdf[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [districts, setDistricts] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const find = async () => {
    setFinding(true);
    try {
      const res = await fetch('/api/admin/guidance-values/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', url }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const rows = (await res.json()).data as FoundPdf[];
      setFound(rows);
      setSelected(new Set(rows.filter((r) => !r.imported).map((r) => r.url)));
      setDistricts(
        Object.fromEntries(rows.map((r) => [r.url, r.district ?? '']))
      );
      setStates({});
      if (!rows.length) toast.error('No PDF links found on that page.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not read the page'
      );
    } finally {
      setFinding(false);
    }
  };

  const setState = (key: string, state: RowState) =>
    setStates((current) => ({ ...current, [key]: state }));

  const importSelected = async () => {
    const queue = found.filter((row) => selected.has(row.url));
    const missing = queue.filter((row) => !districts[row.url]?.trim());
    if (missing.length) {
      toast.error(`Enter a district for ${missing[0].label}.`);
      return;
    }
    setRunning(true);
    cancelRef.current = false;
    let loaded = 0;
    for (const row of queue) {
      if (cancelRef.current) break;
      setState(row.url, 'downloading');
      try {
        const res = await fetch('/api/admin/guidance-values/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'import',
            url: row.url,
            district: districts[row.url].trim(),
            taluk: row.registration_district,
            sro: row.sro,
            title: row.label,
          }),
        });
        if (!res.ok) throw new Error(await readError(res));
        const source = (await res.json()).data as { id: string };
        onImported();
        setState(row.url, 'parsing');
        const ok = await parse(source.id);
        setState(row.url, ok ? 'done' : 'failed');
        if (ok) loaded += 1;
      } catch (err) {
        setState(row.url, 'failed');
        toast.error(
          `${row.label}: ${err instanceof Error ? err.message : 'import failed'}`
        );
      }
    }
    setRunning(false);
    onImported();
    toast.success(`${loaded} of ${queue.length} notifications loaded`);
  };

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Globe className="h-5 w-5" />
          Import from the IGR website
        </h2>
        <p className="text-sm text-slate-400">
          Lists the guidance value PDFs on an IGR page (or takes a single PDF
          link) and imports the ones you pick. Only karnataka.gov.in links are
          fetched. Each PDF is downloaded, then read two pages at a time, so a
          long run can take a while and uses AI on every page. Keep this tab
          open until it finishes.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border-slate-700 bg-slate-950"
        />
        <Button onClick={find} disabled={finding || running}>
          {finding ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Globe className="mr-1 h-4 w-4" />
          )}
          Find PDFs
        </Button>
      </div>

      {found.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {found.length} PDFs · {selected.size} selected ·{' '}
              {found.filter((r) => r.imported).length} already imported
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() =>
                  setSelected(
                    selected.size
                      ? new Set()
                      : new Set(
                          found.filter((r) => !r.imported).map((r) => r.url)
                        )
                  )
                }
              >
                {selected.size ? 'Clear' : 'Select new'}
              </Button>
              {running ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    cancelRef.current = true;
                    stop();
                  }}
                >
                  <Square className="mr-1 h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!selected.size}
                  onClick={importSelected}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Import selected
                </Button>
              )}
            </div>
          </div>
          <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-800">
            {found.map((row) => (
              <div
                key={row.url}
                className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-3 py-2 last:border-b-0"
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${row.label}`}
                  checked={selected.has(row.url)}
                  disabled={running}
                  onChange={() => toggle(row.url)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">
                    {row.sro ?? row.label}
                    {row.kind === 'corrigendum' && (
                      <span className="ml-2 text-xs text-amber-400">
                        corrigendum
                      </span>
                    )}
                    {row.imported && (
                      <span className="ml-2 text-xs text-emerald-400">
                        imported
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {row.registration_district ?? row.label}
                  </p>
                </div>
                <Input
                  aria-label="District"
                  placeholder="District"
                  value={districts[row.url] ?? ''}
                  disabled={running}
                  onChange={(e) =>
                    setDistricts((current) => ({
                      ...current,
                      [row.url]: e.target.value,
                    }))
                  }
                  className="h-8 w-44 border-slate-700 bg-slate-950 text-xs"
                />
                <span className="w-24 text-right text-xs text-slate-400">
                  {states[row.url] === 'downloading' ||
                  states[row.url] === 'parsing' ? (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                  ) : (
                    (states[row.url] ?? '')
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
