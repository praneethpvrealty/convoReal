'use client';

import { useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Upload, X, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ListPropertyFormProps {
  accountId: string;
  siteName: string;
}

interface UploadedImage {
  url: string;
  name: string;
}

function getSessionKey(): string {
  try {
    const existing = localStorage.getItem('showcase_session_key');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem('showcase_session_key', fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

export function ListPropertyForm({ accountId, siteName }: ListPropertyFormProps) {
  const [rawText, setRawText] = useState('');
  const [name, setName] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; whatsappLink: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionKey = useMemo(getSessionKey, []);

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
        const res = await fetch('/api/public/list-property/upload', { method: 'POST', body: form });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || rawText.trim().length < 15) return;
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
          submitter_name: name.trim() || undefined,
          session_key: sessionKey,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        whatsappLink?: string;
        error?: string;
      };
      if (!res.ok || !data.code || !data.whatsappLink) {
        setError(data.error || 'Could not submit your listing. Please try again.');
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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center space-y-4">
        <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold text-white">One last step to submit</h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          Tap the button below to send your verification code on WhatsApp. This confirms your number
          so {siteName} can publish your listing. Your details are saved for 24 hours.
        </p>
        <div className="rounded-lg bg-slate-950 border border-slate-800 py-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Your code</p>
          <p className="text-2xl font-bold text-white tracking-widest">{result.code}</p>
        </div>
        <a
          href={result.whatsappLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-3 rounded-lg transition-colors"
        >
          <MessageCircle className="size-5 fill-white text-emerald-600" />
          Send code on WhatsApp
        </a>
        <p className="text-xs text-slate-500">
          After you send it, you&apos;ll get a confirmation with your property code.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
      <div>
        <label className="block text-sm font-semibold text-white mb-1.5">Property details</label>
        <Textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={8}
          required
          placeholder={
            'Paste or type everything about your property — e.g.\n\n3 BHK apartment for sale in HSR Layout, 1450 sqft, ₹1.35 Cr, east facing, 2 covered parking, near Silk Board metro.'
          }
          className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-primary text-sm resize-y"
        />
        <p className="text-xs text-slate-500 mt-1">
          Include price, location, size, and type. Our AI will structure it for you.
        </p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-white mb-1.5">
          Photos <span className="font-normal text-slate-500">(optional, up to 15)</span>
        </label>
        {images.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-2">
            {images.map((img) => (
              <div key={img.url} className="relative aspect-square rounded-lg overflow-hidden border border-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(img.url)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-0.5"
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
          {uploading ? <Loader2 className="size-4 animate-spin mr-2" /> : <Upload className="size-4 mr-2" />}
          {uploading ? 'Uploading…' : 'Add photos'}
        </Button>
      </div>

      <div>
        <label className="block text-sm font-semibold text-white mb-1.5">
          Your name <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-primary"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button
        type="submit"
        disabled={submitting || uploading || rawText.trim().length < 15}
        className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold py-3"
      >
        {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
        Continue to WhatsApp verification
      </Button>
      <p className="text-xs text-slate-500 text-center">
        You&apos;ll confirm your phone number on WhatsApp — no account needed.
      </p>
    </form>
  );
}
