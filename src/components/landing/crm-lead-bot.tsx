'use client';

import { useCallback, useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { LeadBot } from '@/components/chat/lead-bot';
import { useLeadFunnel, type LeadFunnelApi } from '@/hooks/use-lead-funnel';
import { FUNNEL_END, answerText, type FunnelAnswers } from '@/lib/bot/funnel';
import { crmFunnel } from '@/lib/bot/funnels';
import { getShowcaseSessionKey } from '@/lib/pulse/session-key';
import { BRANDING } from '@/config/branding';

interface CrmLeadBotProps {
  variant: 'floating' | 'inline';
}

interface SiteAskResponse {
  answer?: string | null;
  escalate_whatsapp?: boolean;
  message?: string;
}

const FALLBACK_WHATSAPP =
  process.env.NEXT_PUBLIC_CONVOREAL_SALES_WHATSAPP || '';
const WEBSITE_FUNNEL = crmFunnel('website');

function fallbackWhatsAppLink(): string | null {
  const digits = FALLBACK_WHATSAPP.replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi! I'm interested in ${BRANDING.name}.`)}`;
}

export function CrmLeadBot({ variant }: CrmLeadBotProps) {
  const sessionKey = useMemo(getShowcaseSessionKey, []);
  const [handoffLink, setHandoffLink] = useState<string | null>(null);

  const whatsappCard = useCallback((link: string | null) => {
    const href = link || fallbackWhatsAppLink();
    if (!href) return undefined;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
      >
        <MessageCircle className="size-3.5 fill-white text-emerald-600" />
        Chat with us on WhatsApp
      </a>
    );
  }, []);

  const handleSentinel = useCallback(
    (
      sentinel: string,
      answers: FunnelAnswers,
      api: LeadFunnelApi
    ): string | null => {
      if (sentinel !== FUNNEL_END) return null;

      void (async () => {
        api.setLoading(true);
        try {
          const res = await fetch('/api/public/crm-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: answerText(answers, 'name'),
              phone: answerText(answers, 'phone'),
              role: answerText(answers, 'role'),
              city: answerText(answers, 'city'),
              team_size: answerText(answers, 'team_size'),
              session_key: sessionKey,
              source: 'website',
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            whatsappLink?: string | null;
            error?: string;
          };
          if (!res.ok) {
            api.pushBot(
              data.error ||
                'That did not save — please try the form below, or message us on WhatsApp.',
              whatsappCard(null)
            );
            return;
          }
          setHandoffLink(data.whatsappLink || fallbackWhatsAppLink());
          api.pushBot(
            "Thanks — we'll be in touch shortly. Want to skip the wait? Message us on WhatsApp and we'll get you set up today.",
            whatsappCard(data.whatsappLink || null)
          );
        } catch {
          api.pushBot(
            'Something went wrong saving that. Message us on WhatsApp and we will pick it up.',
            whatsappCard(null)
          );
        } finally {
          api.setLoading(false);
        }
      })();

      return null;
    },
    [sessionKey, whatsappCard]
  );

  const handleQuestion = useCallback(
    async (question: string, _answers: FunnelAnswers, api: LeadFunnelApi) => {
      try {
        const res = await fetch('/api/public/site-ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, session_key: sessionKey }),
        });

        if (res.status === 429) {
          api.pushBot(
            "You're quicker than I am! Give it a moment, or ask us directly on WhatsApp.",
            whatsappCard(null)
          );
          return;
        }

        const data = (await res.json().catch(() => ({}))) as SiteAskResponse;
        if (data.answer) api.pushBot(data.answer);
        else
          api.pushBot(
            data.message || 'Let me get the team to answer that properly.',
            whatsappCard(null)
          );
      } catch {
        api.pushBot(
          'Something went wrong there. You can always reach us on WhatsApp.',
          whatsappCard(null)
        );
      }
    },
    [sessionKey, whatsappCard]
  );

  const bot = useLeadFunnel({
    funnel: WEBSITE_FUNNEL,
    onSentinel: handleSentinel,
    onQuestion: handleQuestion,
  });

  return (
    <LeadBot
      variant={variant}
      title={`Talk to ${BRANDING.name}`}
      subtitle="Ask anything, or get a walkthrough set up"
      launcherLabel="Talk to us"
      messages={bot.messages}
      chips={bot.chips}
      selectedChips={bot.selectedChips}
      onChip={bot.handleChip}
      onSend={bot.handleSend}
      inputMode={bot.step?.input === 'tel' ? 'tel' : 'text'}
      placeholder={
        bot.step?.placeholder || `Ask anything about ${BRANDING.name}…`
      }
      loading={bot.loading}
      footer={
        handoffLink ? (
          <div className="flex justify-center pt-1">
            {whatsappCard(handoffLink)}
          </div>
        ) : undefined
      }
    />
  );
}
