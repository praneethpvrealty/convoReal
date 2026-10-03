'use client';

import { useMemo, useRef, useState } from 'react';
import { Send, MessageCircle, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getShowcaseSessionKey } from '@/lib/pulse/session-key';

interface AskPropertyChatProps {
  accountId: string;
  propertyId: string;
  propertyTitle: string;
  /** Prebuilt wa.me link for the WhatsApp handoff fallback. */
  whatsappLink?: string;
  /** Reuse whatever the visitor already typed into the inquiry form. */
  prefillName?: string;
  prefillPhone?: string;
  /** Fired when the visitor taps the WhatsApp handoff (for analytics). */
  onWhatsAppClick?: () => void;
}

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
  /** Render a WhatsApp handoff button under this message. */
  whatsapp?: boolean;
}

interface AskResponse {
  answer?: string | null;
  source?: 'listing' | 'ai';
  needs_phone?: boolean;
  escalate_whatsapp?: boolean;
  message?: string;
  error?: string;
}

const SUGGESTIONS = [
  'Is the price negotiable?',
  "What's nearby?",
  'What amenities does it have?',
];

export function AskPropertyChat({
  accountId,
  propertyId,
  propertyTitle,
  whatsappLink,
  prefillName,
  prefillPhone,
  onWhatsAppClick,
}: AskPropertyChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phone, setPhone] = useState(prefillPhone || '');
  const [needsPhone, setNeedsPhone] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionKey = useMemo(getShowcaseSessionKey, []);
  const threadRef = useRef<HTMLDivElement>(null);

  const asked = new Set(
    messages.filter((m) => m.role === 'user').map((m) => m.text)
  );
  const suggestions = SUGGESTIONS.filter((s) => !asked.has(s));

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      threadRef.current?.scrollTo?.({
        top: threadRef.current.scrollHeight,
        behavior: 'smooth',
      });
    });
  };

  const pushBot = (text: string, whatsapp = false) => {
    setMessages((m) => [...m, { role: 'bot', text, whatsapp }]);
    scrollToEnd();
  };

  async function ask(question: string, phoneOverride?: string) {
    const q = question.trim();
    if (!q || loading) return;

    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    scrollToEnd();

    try {
      const res = await fetch('/api/public/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          property_id: propertyId,
          question: q,
          session_key: sessionKey,
          visitor_phone: (phoneOverride ?? phone) || undefined,
          visitor_name: prefillName || undefined,
        }),
      });

      if (res.status === 429) {
        pushBot(
          "You're asking quite fast! Give it a moment, then try again — or reach the agent on WhatsApp.",
          true
        );
        return;
      }

      const data = (await res.json().catch(() => ({}))) as AskResponse;

      if (data.answer) {
        pushBot(data.answer);
        setNeedsPhone(false);
      } else if (data.needs_phone) {
        setPendingQuestion(q);
        setNeedsPhone(true);
        pushBot(
          data.message ||
            'Share your number and the agent’s assistant will answer this.'
        );
      } else if (data.escalate_whatsapp) {
        pushBot(
          data.message || "I'll connect you with the agent for this one.",
          true
        );
      } else {
        pushBot(
          'Sorry, I couldn’t get that answer. The agent can help on WhatsApp.',
          true
        );
      }
    } catch {
      pushBot(
        'Something went wrong. Please try WhatsApp to reach the agent.',
        true
      );
    } finally {
      setLoading(false);
    }
  }

  function submitPhoneAndRetry(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() || loading) return;
    setNeedsPhone(false);
    void ask(pendingQuestion, phone.trim());
  }

  return (
    <div className="border-slate-850 rounded-xl border bg-slate-950/60 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="text-primary size-4" />
        <h4 className="text-xs font-bold tracking-wider text-white uppercase">
          Ask about this property
        </h4>
      </div>

      {messages.length > 0 && (
        <div
          ref={threadRef}
          className="mb-2 max-h-56 space-y-2 overflow-y-auto pr-1"
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={
                msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'
              }
            >
              <div
                className={
                  msg.role === 'user'
                    ? 'bg-primary/90 text-primary-foreground max-w-[85%] rounded-lg rounded-br-sm px-3 py-2 text-xs'
                    : 'max-w-[85%] rounded-lg rounded-bl-sm bg-slate-900 px-3 py-2 text-xs text-slate-100'
                }
              >
                <p className="leading-relaxed whitespace-pre-wrap">
                  {msg.text}
                </p>
                {msg.whatsapp && whatsappLink && (
                  <a
                    href={whatsappLink}
                    onClick={onWhatsAppClick}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
                  >
                    <MessageCircle className="size-3.5 fill-white text-emerald-600" />
                    Chat on WhatsApp
                  </a>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-400">
                <Loader2 className="size-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {suggestions.length > 0 && !needsPhone && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={loading}
              onClick={() => ask(s)}
              className="hover:border-primary rounded-full border border-slate-800 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:text-white disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {needsPhone ? (
        <form onSubmit={submitPhoneAndRetry} className="flex gap-2">
          <Input
            type="tel"
            required
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Your mobile number"
            className="border-slate-850 focus:border-primary bg-slate-950 text-xs text-white placeholder:text-slate-600"
          />
          <Button
            type="submit"
            disabled={loading}
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-3 text-xs font-bold"
          >
            Get answer
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask anything about ${propertyTitle.slice(0, 24)}…`}
            className="border-slate-850 focus:border-primary bg-slate-950 text-xs text-white placeholder:text-slate-600"
          />
          <Button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send question"
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-3"
          >
            <Send className="size-4" />
          </Button>
        </form>
      )}
    </div>
  );
}
