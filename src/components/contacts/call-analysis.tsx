'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CallLog } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  CalendarPlus,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  FileAudio,
  ListChecks,
  Loader2,
  Save,
  Send,
  Smartphone,
  Sparkles,
} from 'lucide-react';

interface CallRecordingAnalyzerProps {
  contactId: string;
  contactName: string;
  onAnalyzed: () => void;
}

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export function CallRecordingAnalyzer({ contactId, contactName, onAnalyzed }: CallRecordingAnalyzerProps) {
  const [mode, setMode] = useState<'recording' | 'transcript'>('recording');
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState('');
  const [context, setContext] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyze = async () => {
    if (mode === 'recording' && !file) {
      toast.error('Choose a call recording first');
      return;
    }
    if (mode === 'transcript' && !transcript.trim()) {
      toast.error('Paste the call transcript first');
      return;
    }

    setAnalyzing(true);
    try {
      let audio: { base64: string; mimeType: string } | undefined;
      if (mode === 'recording' && file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Could not read the file'));
          reader.readAsDataURL(file);
        });
        audio = { base64, mimeType: file.type || 'audio/mpeg' };
      }

      const res = await fetch(`/api/contacts/${contactId}/calls/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(audio ? { audio } : {}),
          ...(mode === 'transcript' ? { transcript: transcript.trim() } : {}),
          ...(context.trim() ? { context: context.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      toast.success('Call analyzed — review the update draft below');
      setFile(null);
      setTranscript('');
      setContext('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      onAnalyzed();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-3 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          Analyze a call
        </p>
        <div className="flex rounded-md border border-slate-700 overflow-hidden">
          {(['recording', 'transcript'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 text-xs capitalize cursor-pointer ${
                mode === m ? 'bg-primary/20 text-primary' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === 'recording' ? (
        <div className="space-y-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              if (next && next.size > MAX_AUDIO_BYTES) {
                toast.error('Recording is too large (max 15MB)');
                e.target.value = '';
                return;
              }
              setFile(next);
            }}
            className="w-full text-sm text-slate-400 file:mr-2 file:rounded-md file:border-0 file:bg-slate-700 file:px-2.5 file:py-1.5 file:text-xs file:text-white file:cursor-pointer cursor-pointer"
          />
          {file && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <FileAudio className="size-3" />
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)}MB
            </p>
          )}
        </div>
      ) : (
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste the call transcript…"
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[80px] text-sm resize-none"
        />
      )}

      <Input
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Context (optional) — e.g. Call with lawyer Vijayasathi about the legal report"
        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Drafts a WhatsApp update for {contactName || 'this contact'} — you review before it&apos;s sent.
        </p>
        <Button
          size="sm"
          disabled={analyzing}
          onClick={analyze}
          className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
        >
          {analyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>
    </div>
  );
}

interface CallAnalysisSectionProps {
  contactId: string;
  call: CallLog;
  contactName: string;
  contactPhone: string;
  onUpdated: () => void;
}

export function CallAnalysisSection({
  contactId,
  call,
  contactName,
  contactPhone,
  onUpdated,
}: CallAnalysisSectionProps) {
  const [draft, setDraft] = useState(call.update_draft ?? '');
  const [showTranscript, setShowTranscript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [creatingEvents, setCreatingEvents] = useState(false);
  // Set once the agent has been handed off to their own WhatsApp. The
  // deep link can't report back, so the "mark as sent" prompt has to
  // live here rather than in a toast the agent never comes back to.
  const [handedOff, setHandedOff] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);

  const hasAnalysis =
    call.summary || call.update_draft || call.transcript || call.recording_url;
  if (!hasAnalysis) return null;

  const dirty = draft.trim() !== (call.update_draft ?? '').trim();
  const canSendExternally = contactPhone.replace(/\D/g, '').length > 0;

  const saveDraft = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_draft: draft }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save draft');
      }
      toast.success('Draft saved');
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const createEvents = async () => {
    setCreatingEvents(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/calls/${call.id}/create-events`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create events');
      }
      const { appointments = [], todos = [], liaison } = data.data ?? {};
      const parts = [
        appointments.length > 0 ? `${appointments.length} event${appointments.length > 1 ? 's' : ''}` : null,
        todos.length > 0 ? `${todos.length} to-do${todos.length > 1 ? 's' : ''}` : null,
      ].filter(Boolean);
      toast.success(
        `${parts.join(' + ')} created${liaison ? ` · ${liaison.name} linked for reminders` : ''}`,
      );
      if (liaison && !liaison.has_phone) {
        toast.warning(
          `Add a phone number for ${liaison.name} under Liaisons so their reminders can be delivered.`,
        );
      }
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create events');
    } finally {
      setCreatingEvents(false);
    }
  };

  const sendUpdate = async () => {
    if (!draft.trim()) {
      toast.error('The update draft is empty');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/calls/${call.id}/send-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'CUSTOMER_WINDOW_EXPIRED') {
          // Every escape from here is manual, so name them both rather
          // than leaving the agent to find one.
          setHandedOff(canSendExternally);
          throw new Error(
            canSendExternally
              ? 'The 24-hour WhatsApp window is closed — send it from your own WhatsApp below, or re-engage with a template from the Inbox.'
              : 'The 24-hour WhatsApp window is closed — open the chat in Inbox and send via a template instead.',
          );
        }
        throw new Error(data.error || 'Failed to send update');
      }
      toast.success(`Update sent to ${contactName || 'contact'}`);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send update');
    } finally {
      setSending(false);
    }
  };

  /**
   * The way out of the 24-hour window: hand the same text to the agent's
   * own WhatsApp. No template, no approval, no window — and the line
   * breaks survive, which a template parameter would not allow. The cost
   * is that it leaves from the agent's personal number, so the Engine
   * never sees it and can't confirm it went; hence the manual mark
   * below rather than stamping the row on the way out.
   */
  const sendFromOwnWhatsApp = () => {
    const text = draft.trim();
    if (!text) {
      toast.error('The update draft is empty');
      return;
    }
    window.open(
      `https://wa.me/${contactPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer',
    );
    setHandedOff(true);
  };

  const markSent = async () => {
    setMarkingSent(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_sent: true, update_draft: draft }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to mark as sent');
      }
      setHandedOff(false);
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark as sent');
    } finally {
      setMarkingSent(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 border-t border-slate-700/50 pt-2">
      {call.summary && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
            <Sparkles className="size-3 text-primary" />
            AI Summary
          </p>
          <p className="text-xs text-slate-300 whitespace-pre-wrap">{call.summary}</p>
        </div>
      )}

      {(call.key_points?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Key points</p>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {call.key_points!.map((point, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-slate-600">•</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(call.action_items?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
            <ListChecks className="size-3" />
            Action items
          </p>
          <ul className="text-xs text-slate-400 space-y-0.5">
            {call.action_items!.map((item, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-slate-600">•</span>
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-1.5">
            {call.events_created_at ? (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCheck className="size-3" />
                Events created{' '}
                {new Date(call.events_created_at).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={creatingEvents}
                onClick={createEvents}
                className="border-slate-700 text-slate-300 hover:text-white"
              >
                {creatingEvents ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />}
                {creatingEvents ? 'Creating…' : 'Create events & reminders'}
              </Button>
            )}
          </div>
        </div>
      )}

      {call.recording_url && (
        <audio
          controls
          preload="none"
          src={`/api/contacts/${contactId}/calls/${call.id}/recording`}
          className="w-full h-8"
        />
      )}

      {call.transcript && (
        <div>
          <button
            onClick={() => setShowTranscript((s) => !s)}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            {showTranscript ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
          {showTranscript && (
            <p className="text-xs text-slate-500 whitespace-pre-wrap mt-1 max-h-48 overflow-y-auto rounded-md bg-slate-900/50 p-2">
              {call.transcript}
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            Update for {contactName || 'contact'}
          </p>
          {call.update_sent_at && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCheck className="size-3" />
              Sent{' '}
              {new Date(call.update_sent_at).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          )}
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="No update draft — edit here to compose one"
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 min-h-[80px] text-sm resize-none"
        />
        <div className="flex items-center justify-end gap-2 mt-1.5 flex-wrap">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={saveDraft}
              className="border-slate-700 text-slate-300 hover:text-white"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save draft
            </Button>
          )}
          {canSendExternally && (
            <Button
              size="sm"
              variant="outline"
              disabled={!draft.trim()}
              onClick={sendFromOwnWhatsApp}
              title="Opens WhatsApp on your own number with this text ready to send"
              className="border-green-900/60 text-green-400 hover:bg-green-950/25 hover:text-green-300"
            >
              <Smartphone className="size-3.5" />
              My WhatsApp
            </Button>
          )}
          <Button
            size="sm"
            disabled={sending || !draft.trim()}
            onClick={sendUpdate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {call.update_sent_at ? 'Send again' : 'Send on WhatsApp'}
          </Button>
        </div>
        {handedOff && (
          <div className="flex items-center justify-end gap-2 mt-1.5 text-[11px] text-slate-400">
            <span>Sent it from your WhatsApp?</span>
            <button
              type="button"
              disabled={markingSent}
              onClick={markSent}
              className="font-semibold text-primary hover:text-primary/80 cursor-pointer disabled:opacity-60"
            >
              {markingSent ? 'Marking…' : 'Mark as sent'}
            </button>
            <button
              type="button"
              onClick={() => setHandedOff(false)}
              className="text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
