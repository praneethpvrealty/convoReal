'use client';

import { useMemo, useRef, useState } from 'react';
import {
  FileText,
  Loader2,
  MessageCircle,
  Upload,
  X,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getShowcaseSessionKey } from '@/lib/pulse/session-key';

interface ListPropertyFormProps {
  accountId: string;
  siteName: string;
  requirementLinkToken?: string;
  requirementReference?: string;
}

interface UploadedImage {
  url: string;
  name: string;
}

export function ListPropertyForm({
  accountId,
  siteName,
  requirementLinkToken,
  requirementReference,
}: ListPropertyFormProps) {
  const [rawText, setRawText] = useState('');
  const [name, setName] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [document, setDocument] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    code: string;
    whatsappLink: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const sessionKey = useMemo(getShowcaseSessionKey, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 15 - images.length)) {
        const form = new FormData();
        form.append('account_id', accountId);
        form.append('session_key', sessionKey);
        form.append('file', file);
        const res = await fetch('/api/public/list-property/upload', {
          method: 'POST',
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };
        if (!res.ok || !data.url) {
          setError(data.error || 'One or more photos failed to upload.');
          continue;
        }
        setImages((prev) => [...prev, { url: data.url!, name: file.name }]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((img) => img.url !== url));
  }

  async function handleDocument(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setUploadingDoc(true);
    try {
      const form = new FormData();
      form.append('account_id', accountId);
      form.append('session_key', sessionKey);
      form.append('file', file);
      const res = await fetch('/api/public/list-property/upload', {
        method: 'POST',
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        setError(data.error || 'The brochure failed to upload.');
        return;
      }
      setDocument({ url: data.url, name: file.name });
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || (rawText.trim().length < 15 && !document)) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/list-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          raw_text: rawText.trim(),
          images: images.map((i) => i.url),
          documents: document ? [document.url] : [],
          submitter_name: name.trim() || undefined,
          session_key: sessionKey,
          requirement_link_token: requirementLinkToken,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        whatsappLink?: string;
        error?: string;
      };
      if (!res.ok || !data.code || !data.whatsappLink) {
        setError(
          data.error || 'Could not submit your listing. Please try again.'
        );
        return;
      }
      setResult({ code: data.code, whatsappLink: data.whatsappLink });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
        <h2 className="text-xl font-bold text-white">
          One last step to submit
        </h2>
        <p className="text-sm leading-relaxed text-slate-300">
          Tap the button below to send your verification code on WhatsApp. This
          confirms your number so {siteName} can{' '}
          {requirementReference
            ? `match your listing against ${requirementReference}`
            : 'publish your listing'}
          . Your details are saved for 24 hours.
        </p>
        <div className="rounded-lg border border-slate-800 bg-slate-950 py-3">
          <p className="text-[11px] tracking-wider text-slate-500 uppercase">
            Your code
          </p>
          <p className="text-2xl font-bold tracking-widest text-white">
            {result.code}
          </p>
        </div>
        <a
          href={result.whatsappLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-500"
        >
          <MessageCircle className="size-5 fill-white text-emerald-600" />
          Send code on WhatsApp
        </a>
        <p className="text-xs text-slate-500">
          After you send it, you&apos;ll get a confirmation with your property
          code.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
    >
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-white">
          Property details
        </label>
        <Textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={8}
          required={!document}
          placeholder={
            'Paste or type everything about your property — e.g.\n\n3 BHK apartment for sale in HSR Layout, 1450 sqft, ₹1.35 Cr, east facing, 2 covered parking, near Silk Board metro.'
          }
          className="focus:border-primary resize-y border-slate-800 bg-slate-950 text-sm text-white placeholder:text-slate-600"
        />
        <p className="mt-1 text-xs text-slate-500">
          Include price, location, size, and type — or just attach your brochure
          below. Our AI will structure it for you.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-white">
          Photos{' '}
          <span className="font-normal text-slate-500">
            (optional, up to 15)
          </span>
        </label>
        {images.length > 0 && (
          <div className="mb-2 grid grid-cols-4 gap-2">
            {images.map((img) => (
              <div
                key={img.url}
                className="relative aspect-square overflow-hidden rounded-lg border border-slate-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.url)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 hover:bg-black/80"
                >
                  <X className="size-3.5 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          disabled={uploading || images.length >= 15}
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-slate-800 text-slate-200 hover:bg-slate-800"
        >
          {uploading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Upload className="mr-2 size-4" />
          )}
          {uploading ? 'Uploading…' : 'Add photos'}
        </Button>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-white">
          Brochure / deck{' '}
          <span className="font-normal text-slate-500">
            (optional, one PDF per property)
          </span>
        </label>
        {document ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5">
            <FileText className="size-4 shrink-0 text-slate-400" />
            <span className="flex-1 truncate text-sm text-slate-200">
              {document.name}
            </span>
            <button
              type="button"
              onClick={() => setDocument(null)}
              aria-label="Remove brochure"
              className="rounded-full bg-black/60 p-0.5 hover:bg-black/80"
            >
              <X className="size-3.5 text-white" />
            </button>
          </div>
        ) : (
          <>
            <input
              ref={docInputRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => handleDocument(e.target.files)}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploadingDoc}
              onClick={() => docInputRef.current?.click()}
              className="w-full border-slate-800 text-slate-200 hover:bg-slate-800"
            >
              {uploadingDoc ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <FileText className="mr-2 size-4" />
              )}
              {uploadingDoc ? 'Uploading…' : 'Attach PDF brochure'}
            </Button>
          </>
        )}
        <p className="mt-1 text-xs text-slate-500">
          We read the deck itself — details, floor plans, rent rolls and photos
          come from it.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-white">
          Your name{' '}
          <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="focus:border-primary border-slate-800 bg-slate-950 text-white placeholder:text-slate-600"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button
        type="submit"
        disabled={
          submitting ||
          uploading ||
          uploadingDoc ||
          (rawText.trim().length < 15 && !document)
        }
        className="bg-primary hover:bg-primary-hover text-primary-foreground w-full py-3 font-bold"
      >
        {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
        Continue to WhatsApp verification
      </Button>
      <p className="text-center text-xs text-slate-500">
        You&apos;ll confirm your phone number on WhatsApp — no account needed.
      </p>
    </form>
  );
}
