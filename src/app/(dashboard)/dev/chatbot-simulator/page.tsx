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

type Mode = 'owner_intake' | 'lead_reply' | 'buyer_matches';

type LeadRoute =
  | 'callback_handover'
  | 'property_enquiry'
  | 'property_interest'
  | 'property_disinterest'
  | 'photo_request'
  | 'shortlist_reference'
  | 'qualification';

const ROUTE_LABELS: Record<LeadRoute, string> = {
  callback_handover: 'Callback handover',
  property_enquiry: 'Showcase enquiry',
  property_interest: 'Specific property interest',
  property_disinterest: 'Property disinterest',
  photo_request: 'Photo request',
  shortlist_reference: 'Listing by number',
  qualification: 'Qualification ladder',
};

interface SimulateResult {
  classification?: 'property' | 'contact' | 'schedule' | 'none';
  draft?: unknown;
  isValid?: boolean | null;
  missingFields?: string[];
  status?: string | null;
  previewText: string | null;
  // lead_reply only
  mode?: Mode;
  contactName?: string;
  route?: LeadRoute;
  routeExplanation?: string;
  ladderStoodDown?: boolean;
  notifiesAgent?: boolean;
  answeredFromListing?: boolean;
  photoCount?: number;
  galleryCount?: number;
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
  const [subjectPropertyCode, setSubjectPropertyCode] = useState('');
  const [phone, setPhone] = useState('');
  const [image, setImage] = useState<{ file: File; previewUrl: string } | null>(
    null
  );
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
    if (
      running ||
      (mode === 'buyer_matches'
        ? !phone.trim()
        : !text.trim() && !(image && mode === 'owner_intake'))
    )
      return;
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
        subjectPropertyCode?: string;
        phone?: string;
      } = { text: text.trim() };
      if (mode === 'buyer_matches') {
        body.mode = 'buyer_matches';
        body.phone = phone.trim();
      } else if (mode === 'lead_reply') {
        body.mode = 'lead_reply';
        body.priorRequirements = priorRequirements.trim();
        body.contactName = contactName.trim();
        body.subjectPropertyCode = subjectPropertyCode.trim();
      } else if (image) {
        body.imageBase64 = await fileToBase64(image.file);
        body.mimeType = image.file.type;
      }
      const res = await fetch('/api/dev/simulate-chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as SimulateResult & {
        error?: string;
      };
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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-white">Chatbot simulator</h1>
        <p className="mt-1 text-sm text-slate-400">
          Paste a message (and optionally an image) exactly as it would arrive
          on WhatsApp. This runs the real classify → parse → validate pipeline —
          no message is sent, no draft session is created, and no AI credits are
          charged.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input */}
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex gap-2">
            {(
              [
                ['owner_intake', 'Owner intake'],
                ['lead_reply', 'Lead reply'],
                ['buyer_matches', 'Buyer matches'],
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
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            {mode === 'owner_intake'
              ? 'You messaging your own Engine number — classify → parse → draft preview.'
              : mode === 'lead_reply'
                ? 'A lead replying on WhatsApp — routing → signal gate → preference extraction → qualifier ladder → reply.'
                : 'Preview the exact Show Properties reply for a saved buyer, without sending a message.'}
          </p>

          {mode === 'buyer_matches' && (
            <>
              <label className="block text-sm font-semibold text-white">
                Buyer phone
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +91 98765 43210"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </>
          )}

          {mode === 'lead_reply' && (
            <>
              <label className="block text-sm font-semibold text-white">
                Contact name
              </label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Tanwi"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />

              <label className="block text-sm font-semibold text-white">
                Requirements already on file
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  Leave empty for a first reply. Put earlier answers here to
                  test a later turn.
                </span>
              </label>
              <Textarea
                value={priorRequirements}
                onChange={(e) => setPriorRequirements(e.target.value)}
                rows={3}
                placeholder="e.g. Land , 1.5 to 2cr"
                className="resize-y border-slate-800 bg-slate-950 text-sm text-white placeholder:text-slate-600"
              />

              <label className="block text-sm font-semibold text-white">
                Listing the lead is looking at
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  Property code. Live this comes off the share ledger — set it
                  here to preview a photo request. Leave empty to see what a
                  lead gets when the thread isn&apos;t pinned to a listing.
                </span>
              </label>
              <input
                value={subjectPropertyCode}
                onChange={(e) => setSubjectPropertyCode(e.target.value)}
                placeholder="e.g. PROP-1031"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </>
          )}

          <label
            className={
              mode === 'buyer_matches'
                ? 'hidden'
                : 'block text-sm font-semibold text-white'
            }
          >
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
            className={`${mode === 'buyer_matches' ? 'hidden' : ''}bg-slate-950 resize-y border-slate-800 text-sm text-white placeholder:text-slate-600`}
          />

          <div className={mode !== 'owner_intake' ? 'hidden' : undefined}>
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
                <img
                  src={image.previewUrl}
                  alt="Selected"
                  className="h-24 rounded-lg border border-slate-800"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="Remove image"
                  className="absolute -top-2 -right-2 rounded-full bg-black/70 p-1 hover:bg-black"
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
                <ImageIcon className="mr-2 size-4" />
                Attach image
              </Button>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button
            onClick={handleRun}
            disabled={
              running ||
              (mode === 'buyer_matches'
                ? !phone.trim()
                : !text.trim() && !(image && mode === 'owner_intake'))
            }
            className="bg-primary hover:bg-primary-hover text-primary-foreground w-full font-bold"
          >
            {running ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Play className="mr-2 size-4" />
            )}
            Run simulation
          </Button>
        </div>

        {/* Output */}
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <label className="block text-sm font-semibold text-white">
            Result
          </label>

          {!result && !running && (
            <p className="text-sm text-slate-500">
              Run a simulation to see the classification, parsed draft, and
              preview message.
            </p>
          )}
          {running && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" /> Classifying and
              parsing…
            </div>
          )}

          {result && result.mode === 'lead_reply' && (
            <div className="space-y-4">
              <div>
                <span className="text-xs tracking-wider text-slate-500 uppercase">
                  Who answers this
                </span>
                <p className="text-sm font-bold text-white">
                  {result.route
                    ? ROUTE_LABELS[result.route]
                    : 'Qualification ladder'}
                </p>
                {result.routeExplanation && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {result.routeExplanation}
                  </p>
                )}
              </div>

              {result.ladderStoodDown ? (
                <div>
                  <span className="text-xs tracking-wider text-slate-500 uppercase">
                    Ladder
                  </span>
                  <p className="text-sm font-bold text-white">
                    Stands down
                    <span className="font-normal text-slate-400">
                      {' '}
                      — nothing filed on the contact, no extraction charged
                    </span>
                  </p>
                  {result.notifiesAgent && (
                    <p className="mt-0.5 text-xs text-amber-400">
                      An agent is notified — the lead has been promised
                      something a person owes them.
                    </p>
                  )}
                  {result.answeredFromListing && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      The exact wording depends on the listing and the question,
                      so it isn&apos;t previewed here.
                    </p>
                  )}
                  {typeof result.photoCount === 'number' &&
                    result.photoCount > 0 && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {result.photoCount} photo
                        {result.photoCount === 1 ? '' : 's'} sent
                        {typeof result.galleryCount === 'number' &&
                        result.galleryCount > result.photoCount
                          ? ` of ${result.galleryCount} — the rest are behind the link`
                          : ''}
                        .
                      </p>
                    )}
                </div>
              ) : (
                <>
                  <div>
                    <span className="text-xs tracking-wider text-slate-500 uppercase">
                      Would the bot answer?
                    </span>
                    <p className="text-sm font-bold text-white">
                      {result.carriesRequirementSignal ? (
                        'Yes — the message carries requirement detail'
                      ) : (
                        <>
                          Only mid-ladder
                          <span className="font-normal text-slate-400">
                            {' '}
                            — no signal on its own, so the live handler answers
                            this only if it arrives right after a bot question
                          </span>
                        </>
                      )}
                    </p>
                  </div>

                  <div>
                    <span className="text-xs tracking-wider text-slate-500 uppercase">
                      Ladder
                    </span>
                    <p className="text-sm font-bold text-white">
                      {result.nextQualifier ? (
                        <>
                          Asking for{' '}
                          <span className="capitalize">
                            {result.nextQualifier}
                          </span>
                        </>
                      ) : (
                        <>
                          Complete — {result.matchCount} match
                          {result.matchCount === 1 ? '' : 'es'} from{' '}
                          {result.inventorySize} live listing
                          {result.inventorySize === 1 ? '' : 's'}
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}

              {result.matches && result.matches.length > 0 && (
                <div>
                  <span className="text-xs tracking-wider text-slate-500 uppercase">
                    Top matches
                  </span>
                  <ul className="mt-1 space-y-1">
                    {result.matches.map((m) => (
                      <li key={m.title} className="text-xs text-slate-300">
                        <span className="text-slate-500">{m.score}</span> ·{' '}
                        {m.title}
                        {m.location && (
                          <span className="text-slate-500">
                            {' '}
                            — {m.location}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.previewText && (
                <div>
                  <span className="text-xs tracking-wider text-slate-500 uppercase">
                    WhatsApp reply
                  </span>
                  <pre className="mt-1 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs whitespace-pre-wrap text-slate-200">
                    {result.previewText}
                  </pre>
                </div>
              )}

              {result.preferences != null && (
                <div>
                  <span className="text-xs tracking-wider text-slate-500 uppercase">
                    Extracted preferences
                  </span>
                  <pre className="mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs whitespace-pre-wrap text-slate-400">
                    {JSON.stringify(result.preferences, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {result && result.mode === 'buyer_matches' && (
            <div className="space-y-4">
              <div>
                <span className="text-xs tracking-wider text-slate-500 uppercase">
                  Buyer
                </span>
                <p className="text-sm font-bold text-white">
                  {result.contactName || phone}
                </p>
              </div>
              <div>
                <span className="text-xs tracking-wider text-slate-500 uppercase">
                  WhatsApp reply
                </span>
                <pre className="mt-1 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs whitespace-pre-wrap text-slate-200">
                  {result.previewText ||
                    'No buyer brief is active for this contact.'}
                </pre>
              </div>
            </div>
          )}

          {result &&
            result.mode !== 'lead_reply' &&
            result.mode !== 'buyer_matches' && (
              <div className="space-y-4">
                <div>
                  <span className="text-xs tracking-wider text-slate-500 uppercase">
                    Classification
                  </span>
                  <p className="text-sm font-bold text-white capitalize">
                    {result.classification}
                  </p>
                </div>

                {result.status && (
                  <div>
                    <span className="text-xs tracking-wider text-slate-500 uppercase">
                      Draft status
                    </span>
                    <p className="text-sm font-bold text-white">
                      {result.status}
                      {(result.missingFields?.length ?? 0) > 0 && (
                        <span className="font-normal text-slate-400">
                          {' '}
                          — missing: {result.missingFields?.join(', ')}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {result.previewText && (
                  <div>
                    <span className="text-xs tracking-wider text-slate-500 uppercase">
                      WhatsApp preview
                    </span>
                    <pre className="mt-1 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs whitespace-pre-wrap text-slate-200">
                      {result.previewText}
                    </pre>
                  </div>
                )}

                {result.draft != null && (
                  <div>
                    <span className="text-xs tracking-wider text-slate-500 uppercase">
                      Raw parsed draft
                    </span>
                    <pre className="mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs whitespace-pre-wrap text-slate-400">
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
