"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Mic, Sparkles, Square, Loader2, X, Check, Calendar as CalendarIcon, ListTodo, User, Home, MapPin, AudioLines } from "lucide-react";
import { toast } from "sonner";
import { eventTypeMeta } from "./event-types";
import { microphoneErrorMessage } from "./mic-error";
import { NameTagBadge } from "@/components/contacts/name-tag-badge";

interface ParseResponse {
  draft: {
    intent: "schedule" | "task" | "none";
    title: string;
    event_type: string;
    priority: "low" | "medium" | "high";
    location: string | null;
    notes: string | null;
    transcript: string | null;
    contact_name: string | null;
    property_hint: string | null;
    assignee_name: string | null;
  };
  resolved: {
    start_time: string | null;
    end_time: string | null;
    contact: { id: string; name: string; phone: string; name_tag?: string | null } | null;
    property: { id: string; title: string } | null;
    assignee: { user_id: string; full_name: string | null } | null;
  } | null;
}

export interface ConfirmedEventDraft {
  kind: "appointment" | "todo";
  title: string;
  event_type: string;
  start_time: string | null;
  end_time: string | null;
  contact_id: string | null;
  property_id: string | null;
  assigned_to: string | null;
  location: string | null;
  priority: "low" | "medium" | "high";
  notes: string | null;
  source: "web" | "voice";
  transcript: string | null;
}

interface SmartAddBarProps {
  onConfirm: (draft: ConfirmedEventDraft) => Promise<void>;
}

/** One box to log anything: type "site visit with Varun tomorrow 4pm
 *  at JP Nagar" or hold the mic and say it. AI parses, resolves the
 *  contact/property/teammate, and shows a one-tap confirm card. */
export function SmartAddBar({ onConfirm }: SmartAddBarProps) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ParseResponse | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const callParse = async (payload: { text?: string; audio?: { base64: string; mimeType: string } }) => {
    setParsing(true);
    try {
      const res = await fetch("/api/ai/parse-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to parse");
      const data = json.data as ParseResponse;
      if (data.draft.intent === "none") {
        toast.info("Couldn't find a schedulable event in that. Try including what, who, and when.");
        return;
      }
      setPreview(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse");
    } finally {
      setParsing(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || parsing) return;
    await callParse({ text: text.trim() });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1000) {
          toast.info("Recording was too short — hold the mic and speak the full event.");
          return;
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = () => reject(new Error("Failed to read recording"));
          reader.readAsDataURL(blob);
        });
        await callParse({ audio: { base64, mimeType: recorder.mimeType || "audio/webm" } });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      toast.error(microphoneErrorMessage(err));
    }
  };

  const stopRecording = () => {
    setRecording(false);
    recorderRef.current?.stop();
  };

  const handleConfirm = async () => {
    if (!preview || saving) return;
    const { draft, resolved } = preview;
    setSaving(true);
    try {
      await onConfirm({
        kind: draft.intent === "task" || !resolved?.start_time ? "todo" : "appointment",
        title: draft.title,
        event_type: draft.event_type,
        start_time: resolved?.start_time || null,
        end_time: resolved?.end_time || null,
        contact_id: resolved?.contact?.id || null,
        property_id: resolved?.property?.id || null,
        assigned_to: resolved?.assignee?.user_id || null,
        location: draft.location,
        priority: draft.priority,
        notes: draft.notes,
        source: draft.transcript ? "voice" : "web",
        transcript: draft.transcript,
      });
      setPreview(null);
      setText("");
    } finally {
      setSaving(false);
    }
  };

  const meta = preview ? eventTypeMeta(preview.draft.event_type) : null;

  return (
    <div className="relative">
      <form
        onSubmit={handleTextSubmit}
        className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur focus-within:border-primary/60 transition-colors"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={recording || parsing}
          placeholder='Try "Site visit with Varun at JP Nagar plot tomorrow 4pm" — or tap the mic and say it'
          className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none min-w-0"
        />
        {parsing ? (
          <div className="flex items-center gap-1.5 text-xs text-primary shrink-0">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="hidden sm:inline">Understanding…</span>
          </div>
        ) : recording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center gap-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-400 shrink-0"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            Listening…
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={startRecording}
              title="Log by voice"
              aria-label="Log event by voice"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-primary transition-colors shrink-0"
            >
              <Mic className="h-4 w-4" />
            </button>
            {text.trim() && (
              <button
                type="submit"
                className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 shrink-0"
              >
                Parse
              </button>
            )}
          </>
        )}
      </form>

      {/* Parsed preview → one-tap confirm */}
      {preview && meta && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-xl border border-primary/30 bg-slate-900 p-4 shadow-2xl shadow-primary/10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              {preview.draft.intent === "task" || !preview.resolved?.start_time ? (
                <><ListTodo className="h-3.5 w-3.5" /> New Task</>
              ) : (
                <><CalendarIcon className="h-3.5 w-3.5" /> New Event</>
              )}
              {preview.draft.transcript && (
                <span className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300 normal-case">
                  <AudioLines className="h-3 w-3" /> from voice
                </span>
              )}
            </div>
            <button onClick={() => setPreview(null)} aria-label="Discard" className="text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2 text-sm font-semibold text-white">{preview.draft.title}</p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.chip)}>
              <meta.icon className="h-3 w-3" />
              {meta.label}
            </span>
            {preview.resolved?.start_time && (
              <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                {new Date(preview.resolved.start_time).toLocaleString("en-IN", {
                  weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
                })}
              </span>
            )}
            {preview.resolved?.contact && (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                <User className="h-3 w-3" /> {preview.resolved.contact.name}
                <NameTagBadge tag={preview.resolved.contact.name_tag} />
              </span>
            )}
            {!preview.resolved?.contact && preview.draft.contact_name && (
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                &quot;{preview.draft.contact_name}&quot; — no matching contact
              </span>
            )}
            {preview.resolved?.property && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <Home className="h-3 w-3" /> {preview.resolved.property.title}
              </span>
            )}
            {preview.resolved?.assignee && (
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-400">
                → {preview.resolved.assignee.full_name}
              </span>
            )}
            {preview.draft.location && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                <MapPin className="h-3 w-3" /> {preview.draft.location}
              </span>
            )}
            {preview.draft.priority === "high" && (
              <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-400">
                High
              </span>
            )}
          </div>

          {preview.draft.transcript && (
            <p className="mt-2 text-[11px] italic text-slate-500 line-clamp-2">&ldquo;{preview.draft.transcript}&rdquo;</p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
            >
              Discard
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {preview.draft.intent === "task" || !preview.resolved?.start_time ? "Add Task" : "Add to Calendar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
