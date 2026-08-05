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

type Mode = 'owner_intake' | 'lead_reply';

interface SimulateResult {
  classification?: 'property' | 'contact' | 'schedule' | 'none';
  draft?: unknown;
  isValid?: boolean | null;
  missingFields?: string[];
  status?: string | null;
  previewText: string | null;
  // lead_reply only
  mode?: Mode;
  carriesRequirementSignal?: boolean;
  requirements?: string;
  preferences?: unknown;
  nextQualifier?: 'type' | 'budget' | 'location' | null;
  matchCount?: number;
  matches?: { title: string; score: number; location: string }[];
  inventorySize?: number;
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
  const [mode, setMode] = useState<Mode>('owner_intake');
  const [text, setText] = useState('');
  const [priorRequirements, setPriorRequirements] = useState('');
  const [contactName, setContactName] = useState('');
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
    if (running || (!text.trim() && !(image && mode === 'owner_intake'))) return;
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const body: {
        text: string;
        imageBase64?: string;
        mimeType?: string;
        mode?: Mode;
        priorRequirements?: string;
        contactName?: string;
      } = { text: text.trim() };
      if (mode === 'lead_reply') {
        body.mode = 'lead_reply';
        body.priorRequirements = priorRequirements.trim();
        body.contactName = contactName.trim();
      } else if (image) {
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
          <div className="flex gap-2">
            {(
              [
                ['owner_intake', 'Owner intake'],
                ['lead_reply', 'Lead reply'],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setResult(null);
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            {mode === 'owner_intake'
              ? 'You messaging your own Engine number — classify → parse → draft preview.'
              : 'A lead answering the auto-reply — signal gate → preference extraction → qualifier ladder → reply.'}
          </p>

          {mode === 'lead_reply' && (
            <>
              <label className="block text-sm font-semibold text-white">Contact name</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Tanwi"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 text-white placeholder:text-slate-600 text-sm px-3 py-2"
              />

              <label className="block text-sm font-semibold text-white">
                Requirements already on file
                <span className="block font-normal text-xs text-slate-500 mt-0.5">
                  Leave empty for a first reply. Put earlier answers here to test a later turn.
                </span>
              </label>
              <Textarea
                value={priorRequirements}
                onChange={(e) => setPriorRequirements(e.target.value)}
                rows={3}
                placeholder="e.g. Land , 1.5 to 2cr"
                className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 text-sm resize-y"
              />
            </>
          )}

          <label className="block text-sm font-semibold text-white">
            {mode === 'lead_reply' ? "The lead's new message" : 'Message text'}
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={mode === 'lead_reply' ? 4 : 10}
            placeholder={
              mode === 'lead_reply'
                ? 'e.g. "Land , 1.5 to 2cr"'
                : 'e.g. "3 BHK apartment for sale in HSR Layout, 1450 sqft, ₹1.35 Cr" or "Ravi 9876543210 is interested in SJR Blue Waters"'
            }
            className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 text-sm resize-y"
          />

          <div className={mode === 'lead_reply' ? 'hidden' : undefined}>
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
            disabled={running || (!text.trim() && !(image && mode === 'owner_intake'))}
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

          {result && result.mode === 'lead_reply' && (
            <div className="space-y-4">
              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">Would the bot answer?</span>
                <p className="text-sm font-bold text-white">
                  {result.carriesRequirementSignal ? (
                    'Yes — the message carries requirement detail'
                  ) : (
                    <>
                      Only mid-ladder
                      <span className="text-slate-400 font-normal">
                        {' '}
                        — no signal on its own, so the live handler answers this only if it arrives right after a bot
                        question
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">Ladder</span>
                <p className="text-sm font-bold text-white">
                  {result.nextQualifier ? (
                    <>
                      Asking for <span className="capitalize">{result.nextQualifier}</span>
                    </>
                  ) : (
                    <>
                      Complete — {result.matchCount} match{result.matchCount === 1 ? '' : 'es'} from{' '}
                      {result.inventorySize} live listing{result.inventorySize === 1 ? '' : 's'}
                    </>
                  )}
                </p>
              </div>

              {result.matches && result.matches.length > 0 && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-500">Top matches</span>
                  <ul className="mt-1 space-y-1">
                    {result.matches.map((m) => (
                      <li key={m.title} className="text-xs text-slate-300">
                        <span className="text-slate-500">{m.score}</span> · {m.title}
                        {m.location && <span className="text-slate-500"> — {m.location}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.previewText && (
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-500">WhatsApp reply</span>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono">
                    {result.previewText}
                  </pre>
                </div>
              )}

              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500">Extracted preferences</span>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono max-h-80 overflow-y-auto">
                  {JSON.stringify(result.preferences, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {result && result.mode !== 'lead_reply' && (
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
                    {(result.missingFields?.length ?? 0) > 0 && (
                      <span className="text-slate-400 font-normal"> — missing: {result.missingFields?.join(', ')}</span>
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

              {result.draft != null && (
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
