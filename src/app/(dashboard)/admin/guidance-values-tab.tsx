'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Play, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { BatchImportCard } from './batch-import-card';
import { BulkUploadCard, uploadSourceFile } from './bulk-upload-card';
import { IgrImportCard } from './igr-import-card';

interface GuidanceSource {
  id: string;
  district: string;
  taluk: string | null;
  sro: string | null;
  title: string;
  effective_from: string | null;
  page_count: number | null;
  pages_parsed: number;
  row_count: number;
  status: 'uploaded' | 'parsing' | 'ready' | 'failed';
  error: string | null;
  created_at: string;
}

const EMPTY_FORM = {
  district: 'Bengaluru Urban',
  taluk: '',
  sro: '',
  title: '',
  effective_from: '',
  page_count: '',
};

const QUERY_KEY = ['admin-guidance-sources'];

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `Request failed (${res.status})`;
}

export default function GuidanceValuesTab() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsingId, setParsingId] = useState<string | null>(null);
  const stopRef = useRef(false);

  const { data: sources = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<GuidanceSource[]> => {
      const res = await fetch('/api/admin/guidance-values/sources');
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()).data;
    },
  });

  const setSource = (source: GuidanceSource) =>
    queryClient.setQueryData<GuidanceSource[]>(QUERY_KEY, (current = []) =>
      current.map((row) => (row.id === source.id ? source : row))
    );

  const parse = async (id: string): Promise<boolean> => {
    setParsingId(id);
    stopRef.current = false;
    try {
      while (!stopRef.current) {
        const res = await fetch(
          `/api/admin/guidance-values/sources/${id}/parse`,
          {
            method: 'POST',
          }
        );
        if (!res.ok) throw new Error(await readError(res));
        const source = (await res.json()).data as GuidanceSource;
        setSource(source);
        if (source.status === 'ready') {
          toast.success(`${source.title}: ${source.row_count} rates loaded`);
          return true;
        }
      }
      return false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Parsing failed');
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      return false;
    } finally {
      setParsingId(null);
    }
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const id = await uploadSourceFile(file, {
        district: form.district,
        taluk: form.taluk || undefined,
        sro: form.sro || undefined,
        title: form.title,
        effective_from: form.effective_from || undefined,
        page_count: form.page_count ? Number(form.page_count) : undefined,
      });
      setForm(EMPTY_FORM);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void parse(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this notification and all its rates?')) return;
    const res = await fetch(`/api/admin/guidance-values/sources/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  return (
    <div className="space-y-6">
      <BulkUploadCard
        existingTitles={new Set(sources.map((source) => source.title))}
        parse={parse}
        stop={() => (stopRef.current = true)}
        onUploaded={() =>
          queryClient.invalidateQueries({ queryKey: QUERY_KEY })
        }
      />
      <IgrImportCard
        parse={parse}
        stop={() => (stopRef.current = true)}
        onImported={() =>
          queryClient.invalidateQueries({ queryKey: QUERY_KEY })
        }
      />
      <BatchImportCard
        onChanged={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
      />
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div>
          <h2 className="text-lg font-bold text-white">
            Import a guidance value notification
          </h2>
          <p className="text-sm text-slate-400">
            Upload the Karnataka IGR guidance value PDF for a district, taluk or
            SRO (under 14 MB). It is read two pages at a time; keep this tab
            open until it shows Ready.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(
            [
              ['district', 'District *'],
              ['taluk', 'Taluk'],
              ['sro', 'Sub-registrar office'],
              ['title', 'Title *'],
              ['effective_from', 'Effective from (YYYY-MM-DD)'],
              ['page_count', 'Page count (if known)'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs text-slate-300">{label}</Label>
              <Input
                value={form[key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
                className="border-slate-700 bg-slate-950"
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-slate-300"
          />
          <Button
            onClick={upload}
            disabled={
              uploading || !file || !form.district.trim() || !form.title.trim()
            }
          >
            {uploading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            Upload and parse
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {isLoading && (
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        )}
        {!isLoading && sources.length === 0 && (
          <p className="text-sm text-slate-400">
            No notifications imported yet.
          </p>
        )}
        {sources.map((source) => (
          <div
            key={source.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
          >
            <div className="min-w-0">
              <p className="font-semibold text-white">{source.title}</p>
              <p className="text-xs text-slate-400">
                {[source.district, source.taluk, source.sro]
                  .filter(Boolean)
                  .join(' · ')}
                {source.effective_from
                  ? ` · effective ${source.effective_from}`
                  : ''}
              </p>
              <p className="text-xs text-slate-400">
                {source.status.toUpperCase()} · {source.pages_parsed}/
                {source.page_count ?? '?'} pages · {source.row_count} rates
              </p>
              {source.error && (
                <p className="text-xs text-rose-400">{source.error}</p>
              )}
            </div>
            <div className="flex gap-2">
              {source.status !== 'ready' &&
                (parsingId === source.id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => (stopRef.current = true)}
                  >
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={parsingId !== null}
                    onClick={() => parse(source.id)}
                  >
                    <Play className="mr-1 h-4 w-4" />
                    {source.pages_parsed > 0 ? 'Resume' : 'Parse'}
                  </Button>
                ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={parsingId === source.id}
                onClick={() => remove(source.id)}
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
