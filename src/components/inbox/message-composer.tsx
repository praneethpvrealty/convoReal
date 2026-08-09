"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Mic,
  Loader2,
  MessageCircle,
  ArrowRightCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import {
  pickVoiceNoteMime,
  voiceNoteFilename,
} from "@/lib/whatsapp/voice-note-format";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  /** For the two routes out of a closed window that do not need a
   *  template: the agent's own WhatsApp, and the invite that gets the
   *  contact to open the window themselves. */
  contactPhone?: string | null;
  onInviteToEngine?: () => void;
  onSend: (text: string, replyToId?: string) => void;
  /** Upload the file and send it. Caption comes from whatever is typed. */
  onSendAttachment: (
    file: File,
    caption: string | undefined,
    replyToId?: string,
  ) => Promise<void>;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  sessionExpired,
  contactPhone,
  onInviteToEngine,
  onSend,
  onSendAttachment,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  // A cancelled recording must never be sent, and the recorder's stop
  // event fires either way — so intent is recorded before stopping.
  const keepRecordingRef = useRef(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const sendFile = useCallback(
    async (file: File) => {
      setAttaching(true);
      try {
        await onSendAttachment(file, text.trim() || undefined, replyTo?.id);
        setText("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      } finally {
        setAttaching(false);
      }
    },
    [onSendAttachment, text, replyTo?.id],
  );

  const handleFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset first: picking the same file twice in a row fires no
      // change event otherwise, so a failed send could not be retried.
      e.target.value = "";
      if (file) await sendFile(file);
    },
    [sendFile],
  );

  const stopRecording = useCallback((keep: boolean) => {
    keepRecordingRef.current = keep;
    recorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Firefox records ogg/opus and Safari mp4, but Chrome and Edge
      // default to webm — which WhatsApp refuses. The type is pinned to
      // one Meta accepts rather than transcoded in the page.
      const mimeType = pickVoiceNoteMime((type) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        toast.error(
          "This browser can't record a voice note WhatsApp accepts — attach an audio file instead.",
        );
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      keepRecordingRef.current = true;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (tickRef.current) clearInterval(tickRef.current);
        setRecording(false);
        setRecordSeconds(0);
        if (!keepRecordingRef.current) return;
        const type = recorder.mimeType || mimeType;
        const blob = new Blob(chunksRef.current, { type });
        // Under a second is a mis-click, not a message.
        if (blob.size < 1200) return;
        void sendFile(
          new File([blob], voiceNoteFilename(type, Date.now()), { type }),
        );
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      tickRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Microphone access is needed to record a voice note.");
    }
  }, [sendFile]);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  return (
    <div className="border-t border-slate-900/60 bg-slate-950/70 backdrop-blur-md p-4 relative z-10">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Reach them another way:
          </p>
          {/* Three routes, cheapest first. A template keeps the thread
              on the business number; the agent's own WhatsApp delivers
              whatever is in the box now but off the record; the invite
              fixes the cause, since the window is shut only because
              this contact has never written. */}
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-amber-400 hover:text-amber-300"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="mr-1 h-3 w-3" />
              Templates
            </Button>
            {contactPhone && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-emerald-400 hover:text-emerald-300"
                onClick={() => {
                  // Whatever is in the box goes with them; an empty box
                  // just opens the chat. The draft stays put either way,
                  // because this leaves from a personal number and the
                  // Engine never records it.
                  const digits = contactPhone.replace(/\D/g, '');
                  if (!digits) return;
                  const query = text.trim()
                    ? `?text=${encodeURIComponent(text.trim())}`
                    : '';
                  window.open(`https://wa.me/${digits}${query}`, '_blank', 'noopener');
                }}
              >
                <MessageCircle className="mr-1 h-3 w-3" />
                My WhatsApp
              </Button>
            )}
            {onInviteToEngine && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-slate-400 hover:text-slate-300"
                onClick={onInviteToEngine}
              >
                <ArrowRightCircle className="mr-1 h-3 w-3" />
                Invite to Engine
              </Button>
            )}
          </div>
        </div>
      )}

      {recording ? (
        // Replaces the composer while recording: the two ways out of a
        // recording should be the only things on screen.
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-400" />
          <span className="flex-1 text-sm text-slate-200">
            Recording {Math.floor(recordSeconds / 60)}:
            {String(recordSeconds % 60).padStart(2, "0")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-slate-400 hover:text-white"
            onClick={() => stopRecording(false)}
          >
            Discard
          </Button>
          <Button size="sm" className="h-8" onClick={() => stopRecording(true)}>
            <Send className="mr-1 h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      ) : (
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          onChange={handleFilePicked}
        />
        <GatedButton
          variant="ghost"
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={sessionExpired || attaching}
          title={readOnly ? undefined : "Attach a photo, video or document"}
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white rounded-xl bg-slate-950/40 border border-slate-900 hover:bg-slate-900/50 hover:scale-105 transition-all cursor-pointer flex items-center justify-center"
          onClick={() => fileRef.current?.click()}
        >
          {attaching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </GatedButton>
        <GatedButton
          variant="ghost"
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          title={readOnly ? undefined : "Send Message"}
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white rounded-xl bg-slate-950/40 border border-slate-900 hover:bg-slate-900/50 hover:scale-105 transition-all cursor-pointer flex items-center justify-center"
          onClick={onOpenTemplates}
        >
          <LayoutTemplate className="h-4 w-4" />
        </GatedButton>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            readOnly
              ? "Read-only — viewers can browse but not reply"
              : sessionExpired
                ? "Session expired - use a template"
                : "Type a message... (Shift+Enter for new line)"
          }
          disabled={sessionExpired || readOnly}
          rows={1}
          // Textarea keeps its own inline title — the GatedButton
          // wrapping pattern doesn't apply to non-button inputs.
          // The placeholder text also surfaces the read-only state.
          title={readOnly ? "Read-only — your role can't send messages" : undefined}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-850 bg-slate-950/45 px-4 py-2.5 text-sm text-white placeholder-slate-550 outline-none transition-colors focus:border-primary/50 focus:bg-slate-950/80 focus:ring-1 focus:ring-primary/20",
            (sessionExpired || readOnly) && "cursor-not-allowed opacity-50"
          )}
        />

        {/* Mic until there is something to send, as WhatsApp does. */}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={sessionExpired || sending || attaching}
          onClick={text.trim() ? handleSend : startRecording}
          title={text.trim() ? "Send" : "Record a voice note"}
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary-hover disabled:opacity-40 rounded-xl transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-md shadow-primary/20 flex items-center justify-center text-white"
        >
          {text.trim() ? <Send className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </GatedButton>
      </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge (w-9 button + gap-2 = 44px). */}
      <p className="mt-1 pl-11 text-[10px] text-slate-600">
        Type &apos;/&apos; for quick replies
      </p>
    </div>
  );
}
