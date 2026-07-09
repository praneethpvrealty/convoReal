'use client';

import { useRef, useState } from 'react';
import { Loader2, Play, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// Internal dev tool — exercises the WhatsApp owner chatbot's exact
// classify -> parse -> validate -> preview pipeline (chatbot-engine.ts
// / intake-core.ts) without sending a real WhatsApp message, creating a
// draft session, or burning the account's AI credits. Useful for
// iterating on prompts/parsing and seeing precisely what the bot would
// reply with. Gated by the dashboard layout's auth — any signed-in
// account member can use it (read-only against their own account).

interface SimulateResult {
  classification: 'property' | 'contact' | 'none';
  draft: unknown;
  isValid: boolean | null;
  missingFields: string[];
  status: string | null;
  previewText: string | null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — the API wants raw base64.
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChatbotSimulatorPage() {
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImagePick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setImage({ file, previewUrl: URL.createObjectURL(file) });
  }

  function clearImage() {
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleRun() {
    if (running || (!text.trim() && !image)) return;
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const body: { text: string; imageBase64?: string; mimeType?: string } = { text: text.trim() };
      if (image) {
        body.imageBase64 = await fileToBase64(image.file);
        body.mimeType = image.file.type;
      }
      const res = await fetch('/api/dev/simulate-chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as SimulateResult & { error?: string };
      if (!res.ok) {
        setError(data.error || 'Simulation failed.');
        return;
      }
      setResult(data);
    } catch {
      setError('Something went wrong running the simulation.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Chatbot simulator</h1>
        <p className="text-sm text-slate-400 mt-1">
          Paste a message (and optionally an image) exactly as it would arrive on WhatsApp. This runs the real
          classify → parse → validate pipeline — no message is sent, no draft session is created, and no AI credits
          are charged.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <label className="block text-sm font-semibold text-white">Message text</label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder='e.g. "3 BHK apartment for sale in HSR Layout, 1450 sqft, ₹1.35 Cr" or "Ravi 9876543210 is interested in SJR Blue Waters"'
            className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 text-sm resize-y"
          />

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleImagePick(e.target.files)}
              className="hidden"
            />
            {image ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt="Selected" className="h-24 rounded-lg border border-slate-800" />
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="Remove image"
                  className="absolute -top-2 -right-2 bg-black/70 hover:bg-black rounded-full p-1"
                >
                  <X className="size-3.5 text-white" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="border-slate-800 text-slate-200 hover:bg-slate-800"
              >
                <ImageIcon className="size-4 mr-2" />
                Attach image
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button
            onClick={handleRun}
            disabled={running || (!text.trim() && !image)}
            className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold"
          >
            {running ? <Loader2 className="size-4 animate-spin mr-2" /> : <Play className="size-4 mr-2" />}
            Run simulation
          </Button>
        </div>

        {/* Output */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <label className="block text-sm font-semibold text-white">Result</label>

          {!result && !running && (
            <p className="text-sm text-slate-500">Run a simulation to see the classification, parsed draft, and preview message.</p>
          )}
          {running && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" /> Classifying and parsing…
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">Classification</span>
                <p className="text-sm font-bold text-white capitalize">{result.classification}</p>
              </div>

              {result.status && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-500">Draft status</span>
                  <p className="text-sm font-bold text-white">
                    {result.status}
                    {result.missingFields.length > 0 && (
                      <span className="text-slate-400 font-normal"> — missing: {result.missingFields.join(', ')}</span>
                    )}
                  </p>
                </div>
              )}

              {result.previewText && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-500">WhatsApp preview</span>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono">
                    {result.previewText}
                  </pre>
                </div>
              )}

              {result.draft !== null && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-500">Raw parsed draft</span>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono max-h-80 overflow-y-auto">
                    {JSON.stringify(result.draft, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
