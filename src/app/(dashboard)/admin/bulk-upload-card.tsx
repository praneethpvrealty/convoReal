'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Files, Loader2, Square, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SOURCE_MAX_BYTES,
  isPdfBytes,
  sourceFromFilename,
} from '@/lib/guidance-value/import-url';

interface BulkUploadCardProps {
  existingTitles: Set<string>;
  parse: (sourceId: string) => Promise<boolean>;
  stop: () => void;
  onUploaded: () => void;
}

export interface SourceFields {
  district: string;
  taluk?: string;
  sro?: string;
  title: string;
  effective_from?: string;
  page_count?: number;
}

type RowState = 'uploading' | 'parsing' | 'done' | 'stopped' | 'failed';

interface PendingFile {
  key: string;
  file: File;
  title: string;
  sro: string;
  district: string;
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `Request failed (${res.status})`;
}

export async function uploadSourceFile(
  file: File,
  fields: SourceFields
): Promise<string> {
  const res = await fetch('/api/admin/guidance-values/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...fields,
      filename: file.name,
      mime_type: file.type || 'application/pdf',
      size: file.size,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const { source, upload_url } = (await res.json()).data as {
    source: { id: string };
    upload_url: string;
  };
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!put.ok) throw new Error('Upload to storage failed');
  return source.id;
}

export function BulkUploadCard({
  existingTitles,
  parse,
  stop,
  onUploaded,
}: BulkUploadCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [defaultDistrict, setDefaultDistrict] = useState('Bengaluru Urban');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const sourceIdsRef = useRef<Record<string, string>>({});

  const addFiles = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (fileRef.current) fileRef.current.value = '';
    const tooBig = picked.filter((f) => f.size > SOURCE_MAX_BYTES);
    const signatures = await Promise.all(
      picked.map(async (f) =>
        isPdfBytes(new Uint8Array(await f.slice(0, 5).arrayBuffer()))
      )
    );
    const notPdf = picked.filter((_, i) => !signatures[i]);
    if (tooBig.length) {
      toast.error(`${tooBig.length} file(s) over 14 MB were skipped.`);
    }
    if (notPdf.length) {
      toast.error(`${notPdf.length} file(s) that are not PDFs were skipped.`);
    }
    const accepted = picked.filter(
      (f) => !tooBig.includes(f) && !notPdf.includes(f)
    );
    setFiles((current) => {
      const keys = new Set(current.map((f) => f.key));
      const added = accepted
        .map((file) => {
          const guess = sourceFromFilename(file.name);
          return {
            key: `${file.name}:${file.size}:${file.lastModified}`,
            file,
            title: guess.title,
            sro: guess.sro ?? '',
            district: guess.district ?? '',
          };
        })
        .filter((f) => !keys.has(f.key));
      return [...current, ...added];
    });
  };

  const update = (key: string, patch: Partial<PendingFile>) =>
    setFiles((current) =>
      current.map((f) => (f.key === key ? { ...f, ...patch } : f))
    );

  const run = async () => {
    const queue = files.filter((f) => states[f.key] !== 'done');
    const unnamed = queue.find((f) => !(f.district || defaultDistrict).trim());
    if (unnamed) {
      toast.error(`Enter a district for ${unnamed.file.name}.`);
      return;
    }
    setRunning(true);
    cancelRef.current = false;
    let loaded = 0;
    for (const item of queue) {
      if (cancelRef.current) break;
      try {
        let id = sourceIdsRef.current[item.key];
        if (!id) {
          setStates((s) => ({ ...s, [item.key]: 'uploading' }));
          id = await uploadSourceFile(item.file, {
            district: (item.district || defaultDistrict).trim(),
            sro: item.sro.trim() || undefined,
            title: item.title.trim() || item.file.name,
            effective_from: effectiveFrom.trim() || undefined,
          });
          sourceIdsRef.current[item.key] = id;
          onUploaded();
        }
        if (cancelRef.current) {
          setStates((s) => ({ ...s, [item.key]: 'stopped' }));
          break;
        }
        setStates((s) => ({ ...s, [item.key]: 'parsing' }));
        const ok = await parse(id);
        setStates((s) => ({
          ...s,
          [item.key]: ok ? 'done' : cancelRef.current ? 'stopped' : 'failed',
        }));
        if (ok) loaded += 1;
      } catch (err) {
        setStates((s) => ({ ...s, [item.key]: 'failed' }));
        toast.error(
          `${item.file.name}: ${err instanceof Error ? err.message : 'upload failed'}`
        );
      }
    }
    setRunning(false);
    onUploaded();
    toast.success(`${loaded} of ${queue.length} PDFs loaded`);
  };

  const pending = files.filter((f) => states[f.key] !== 'done').length;

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <Files className="h-5 w-5" />
          Upload many PDFs
        </h2>
        <p className="text-sm text-slate-400">
          Download the notifications from the IGR website in your browser, then
          select them all here. The SRO and district are guessed from each file
          name — check them, then upload. Files are read one after another; keep
          this tab open until the list shows done.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs text-slate-300">
            District when the name has none
          </Label>
          <Input
            value={defaultDistrict}
            disabled={running}
            onChange={(e) => setDefaultDistrict(e.target.value)}
            className="border-slate-700 bg-slate-950"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-300">
            Effective from (YYYY-MM-DD, optional)
          </Label>
          <Input
            value={effectiveFrom}
            disabled={running}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="border-slate-700 bg-slate-950"
          />
        </div>
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <Button
            variant="outline"
            disabled={running}
            onClick={() => fileRef.current?.click()}
          >
            <Files className="mr-1 h-4 w-4" />
            Choose PDFs
          </Button>
          {running ? (
            <Button
              variant="outline"
              onClick={() => {
                cancelRef.current = true;
                stop();
              }}
            >
              <Square className="mr-1 h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button disabled={!pending} onClick={run}>
              <Upload className="mr-1 h-4 w-4" />
              Upload {pending || ''}
            </Button>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-800">
          {files.map((item) => {
            const state = states[item.key];
            const duplicate = existingTitles.has(item.title.trim());
            return (
              <div
                key={item.key}
                className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">
                    {item.file.name}
                    {duplicate && (
                      <span className="ml-2 text-xs text-amber-400">
                        already uploaded
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(item.file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <Input
                  aria-label="SRO"
                  placeholder="SRO"
                  value={item.sro}
                  disabled={running}
                  onChange={(e) => update(item.key, { sro: e.target.value })}
                  className="h-8 w-40 border-slate-700 bg-slate-950 text-xs"
                />
                <Input
                  aria-label="District"
                  placeholder={defaultDistrict || 'District'}
                  value={item.district}
                  disabled={running}
                  onChange={(e) =>
                    update(item.key, { district: e.target.value })
                  }
                  className="h-8 w-40 border-slate-700 bg-slate-950 text-xs"
                />
                <span className="w-16 text-right text-xs text-slate-400">
                  {state === 'uploading' || state === 'parsing' ? (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                  ) : (
                    (state ?? '')
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove"
                  disabled={running}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((f) => f.key !== item.key)
                    )
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
