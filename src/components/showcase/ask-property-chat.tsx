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

const SUGGESTIONS = ['Is the price negotiable?', "What's nearby?", 'What amenities does it have?'];

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

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
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
        pushBot("You're asking quite fast! Give it a moment, then try again — or reach the agent on WhatsApp.", true);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as AskResponse;

      if (data.answer) {
        pushBot(data.answer);
        setNeedsPhone(false);
      } else if (data.needs_phone) {
        setPendingQuestion(q);
        setNeedsPhone(true);
        pushBot(data.message || 'Share your number and the agent’s assistant will answer this.');
      } else if (data.escalate_whatsapp) {
        pushBot(data.message || "I'll connect you with the agent for this one.", true);
      } else {
        pushBot('Sorry, I couldn’t get that answer. The agent can help on WhatsApp.', true);
      }
    } catch {
      pushBot('Something went wrong. Please try WhatsApp to reach the agent.', true);
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
    <div className="rounded-xl border border-slate-850 bg-slate-950/60 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="size-4 text-primary" />
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Ask about this property</h4>
      </div>

      {messages.length > 0 && (
        <div ref={threadRef} className="max-h-56 overflow-y-auto space-y-2 mb-2 pr-1">
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  msg.role === 'user'
                    ? 'max-w-[85%] rounded-lg rounded-br-sm bg-primary/90 text-primary-foreground text-xs px-3 py-2'
                    : 'max-w-[85%] rounded-lg rounded-bl-sm bg-slate-900 text-slate-100 text-xs px-3 py-2'
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                {msg.whatsapp && whatsappLink && (
                  <a
                    href={whatsappLink}
                    onClick={onWhatsAppClick}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-md transition-colors"
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
              <div className="rounded-lg bg-slate-900 text-slate-400 text-xs px-3 py-2 flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="text-[11px] text-slate-300 border border-slate-800 hover:border-primary hover:text-white rounded-full px-2.5 py-1 transition-colors"
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
            className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs"
          />
          <Button type="submit" disabled={loading} className="bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold px-3">
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
            className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs"
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
