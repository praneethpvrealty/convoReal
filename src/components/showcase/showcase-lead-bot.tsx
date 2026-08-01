'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { MessageCircle, UserPlus } from 'lucide-react';
import { LeadBot } from '@/components/chat/lead-bot';
import { useLeadFunnel, type LeadFunnelApi } from '@/hooks/use-lead-funnel';
import {
  FUNNEL_CRM,
  FUNNEL_END,
  FUNNEL_MATCH,
  answerList,
  answerText,
  type FunnelAnswers,
} from '@/lib/bot/funnel';
import {
  crmFunnel,
  RENT_INTENT,
  SHOWCASE_AFTER_MATCH,
  SHOWCASE_FUNNEL,
} from '@/lib/bot/funnels';
import {
  catalogCategories,
  catalogLocalities,
  matchProperties,
  parseBudgetText,
  type BudgetRange,
} from '@/lib/bot/catalog-match';
import { getShowcaseSessionKey } from '@/lib/pulse/session-key';
import { storagePublicUrl } from '@/lib/storage/url';
import type { Property } from '@/types';

interface ShowcaseLeadBotProps {
  variant: 'floating' | 'inline';
  accountId: string;
  properties: Property[];
  /** Account-level WhatsApp handoff for questions the bot can't answer. */
  whatsappLink?: string;
  referrerContactId?: string;
  onSelectProperty: (property: Property) => void;
  onWhatsAppClick?: () => void;
  /** Fired when the visitor takes up the free buyer account. */
  onAccountClick?: () => void;
}

const SHOWCASE_CRM_FUNNEL = crmFunnel('showcase');

interface AskResponse {
  answer?: string | null;
  needs_phone?: boolean;
  escalate_whatsapp?: boolean;
  message?: string;
}

function inr(amount: number): string {
  if (amount >= 10_000_000)
    return `₹${(amount / 10_000_000).toFixed(2).replace(/\.00$/, '')} Cr`;
  if (amount >= 100_000)
    return `₹${(amount / 100_000).toFixed(2).replace(/\.00$/, '')} L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

function priceLabel(property: Property): string {
  if (property.listing_type === 'Rent') {
    return property.rent_per_month
      ? `${inr(property.rent_per_month)}/month`
      : 'Rent on request';
  }
  return property.price ? inr(property.price) : 'Price on request';
}

export function ShowcaseLeadBot({
  variant,
  accountId,
  properties,
  whatsappLink,
  referrerContactId,
  onSelectProperty,
  onWhatsAppClick,
  onAccountClick,
}: ShowcaseLeadBotProps) {
  const sessionKey = useMemo(getShowcaseSessionKey, []);
  // Which funnel finished, so the closing state offers the right next
  // step: a buyer gets their free account, a professional gets the
  // ConvoReal handoff. Never the other way round.
  const [completed, setCompleted] = useState<'buyer' | 'crm' | null>(null);
  const budgetRef = useRef<BudgetRange>({ min: null, max: null });

  const chipsFor = useCallback(
    (source: 'categories' | 'localities') =>
      source === 'categories'
        ? catalogCategories(properties)
        : catalogLocalities(properties),
    [properties]
  );

  const matchCard = useCallback(
    (matches: Property[]) => (
      <div className="space-y-1.5">
        {matches.map((property) => (
          <button
            key={property.id}
            type="button"
            onClick={() => onSelectProperty(property)}
            className="border-slate-850 hover:border-primary/50 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-slate-950/60 p-2 text-left transition-colors"
          >
            {property.images?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={storagePublicUrl(property.images[0])}
                alt={property.title}
                className="border-slate-850 size-11 shrink-0 rounded-md border object-cover"
              />
            ) : (
              <div className="border-slate-850 size-11 shrink-0 rounded-md border bg-slate-900" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-bold text-white">
                {property.title}
              </span>
              <span className="block truncate text-[10px] text-slate-400">
                {[
                  property.sublocality || property.location,
                  priceLabel(property),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    ),
    [onSelectProperty]
  );

  const whatsappCard = useMemo(
    () =>
      whatsappLink ? (
        <a
          href={whatsappLink}
          onClick={onWhatsAppClick}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
        >
          <MessageCircle className="size-3.5 fill-white text-emerald-600" />
          Chat on WhatsApp
        </a>
      ) : null,
    [onWhatsAppClick, whatsappLink]
  );

  // The buyer's own free account: the existing buyer portal, signed
  // into with the number they just gave us — so the contact this
  // requirement created is what their account links to. No second
  // sign-up form, no password.
  const accountCard = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-1.5">
        <a
          href="/buyer/login?next=/buyer/matches"
          target="_blank"
          rel="noreferrer"
          onClick={onAccountClick}
          className="bg-primary hover:bg-primary-hover text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-colors"
        >
          <UserPlus className="size-3.5" />
          Create my free account
        </a>
        {whatsappCard}
      </div>
    ),
    [onAccountClick, whatsappCard]
  );

  const showMatches = useCallback(
    (answers: FunnelAnswers) => {
      const intent = answerText(answers, 'intent');
      const budget = parseBudgetText(answerText(answers, 'budget'));
      budgetRef.current = budget;

      const { matches, relaxed, scopeCount } = matchProperties(properties, {
        intent,
        category: answerText(answers, 'category'),
        localities: answerList(answers, 'locality'),
        budget,
      });

      if (!matches.length) {
        return {
          text:
            scopeCount > 0
              ? 'Nothing on the site fits that brief right now — but plenty never makes it to the website. Let me take your details so the agent can send you the off-market ones.'
              : "I don't have anything live that fits that yet. Leave your details and the agent will come back the moment something does.",
          attachment: undefined,
        };
      }

      return {
        text: relaxed
          ? `Nothing matched exactly, but these are the closest ${matches.length === 1 ? 'one' : `${matches.length}`} I have:`
          : `Here ${matches.length === 1 ? 'is 1 that fits' : `are ${matches.length} that fit`}:`,
        attachment: matchCard(matches),
      };
    },
    [matchCard, properties]
  );

  const submitBuyer = useCallback(
    async (answers: FunnelAnswers) => {
      const intent = answerText(answers, 'intent');
      const isRent = intent === RENT_INTENT;
      const budget = budgetRef.current;
      const budgetText = answerText(answers, 'budget');
      const category = answerText(answers, 'category');
      const localities = answerList(answers, 'locality');

      const notes = [
        `Captured by the showcase assistant.`,
        intent ? `Intent: ${intent}.` : '',
        // Rent figures are monthly and would be misread by the sale
        // budget parser, so they ride in the note instead.
        isRent && budgetText ? `Monthly rent budget: ${budgetText}.` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const res = await fetch('/api/public/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: answerText(answers, 'name'),
          phone: answerText(answers, 'phone'),
          categories: category ? [category] : [],
          locations: localities,
          minBudget: isRent ? null : budget.min,
          maxBudget: isRent ? null : budget.max,
          notes,
          accountId,
          referrerContactId,
          // The number step says the agent will send matching listings
          // to this WhatsApp number — answering it is the opt-in.
          alertsConsent: true,
        }),
      });
      if (!res.ok) throw new Error('requirements submission failed');
    },
    [accountId, referrerContactId]
  );

  const submitCrmProspect = useCallback(
    async (answers: FunnelAnswers) => {
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
          source: 'showcase',
          source_account_id: accountId,
        }),
      });
      if (!res.ok) throw new Error('crm lead submission failed');
    },
    [accountId, sessionKey]
  );

  const funnelRef = useRef<'showcase' | 'crm'>('showcase');

  const handleSentinel = useCallback(
    (
      sentinel: string,
      answers: FunnelAnswers,
      api: LeadFunnelApi
    ): string | null => {
      if (sentinel === FUNNEL_CRM) {
        funnelRef.current = 'crm';
        api.switchFunnel(SHOWCASE_CRM_FUNNEL);
        return null;
      }

      if (sentinel === FUNNEL_MATCH) {
        const { text, attachment } = showMatches(answers);
        api.pushBot(text, attachment);
        return SHOWCASE_AFTER_MATCH;
      }

      if (sentinel === FUNNEL_END) {
        const isCrm = funnelRef.current === 'crm';
        void (async () => {
          api.setLoading(true);
          try {
            if (isCrm) await submitCrmProspect(answers);
            else await submitBuyer(answers);
            setCompleted(isCrm ? 'crm' : 'buyer');
            // The buyer's CTA lives in the persistent footer below, so
            // the message itself carries no duplicate button.
            api.pushBot(
              isCrm
                ? "Perfect — the ConvoReal team will reach out on WhatsApp shortly. Want to see it running on your own inventory? They'll set up a walkthrough."
                : 'Done — the agent has your requirement and will send matching listings on WhatsApp, including the ones that never go public.',
              isCrm ? (whatsappCard ?? undefined) : undefined
            );
            if (!isCrm) {
              api.pushBot(
                'One more thing: a free account keeps every match in one place, lets you shortlist what you like, and shows owner-direct listings too. It signs you in on the number you just gave me — no password.'
              );
            }
          } catch {
            api.pushBot(
              'I could not save that just now. Please reach the team on WhatsApp and they will pick it up.',
              whatsappCard ?? undefined
            );
          } finally {
            api.setLoading(false);
          }
        })();
        return null;
      }

      return null;
    },
    [showMatches, submitBuyer, submitCrmProspect, whatsappCard]
  );

  const handleQuestion = useCallback(
    async (question: string, answers: FunnelAnswers, api: LeadFunnelApi) => {
      try {
        const res = await fetch('/api/public/catalog-ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accountId,
            question,
            session_key: sessionKey,
            visitor_phone: answerText(answers, 'phone') || undefined,
            visitor_name: answerText(answers, 'name') || undefined,
            criteria: {
              intent: answerText(answers, 'intent'),
              category: answerText(answers, 'category'),
              localities: answerList(answers, 'locality'),
              budget: budgetRef.current,
            },
          }),
        });

        if (res.status === 429) {
          api.pushBot(
            "That's a lot of questions at once! Give it a moment, or reach the agent on WhatsApp.",
            whatsappCard ?? undefined
          );
          return;
        }

        const data = (await res.json().catch(() => ({}))) as AskResponse;
        if (data.answer) {
          api.pushBot(data.answer);
        } else if (data.needs_phone) {
          api.pushBot(
            data.message ||
              "Share your number and I'll dig into the full inventory for you."
          );
        } else {
          api.pushBot(
            data.message || 'The agent can answer that one properly.',
            whatsappCard ?? undefined
          );
        }
      } catch {
        api.pushBot(
          'Something went wrong there. The agent can help on WhatsApp.',
          whatsappCard ?? undefined
        );
      }
    },
    [accountId, sessionKey, whatsappCard]
  );

  const bot = useLeadFunnel({
    funnel: SHOWCASE_FUNNEL,
    chipsFor,
    onSentinel: handleSentinel,
    onQuestion: handleQuestion,
  });

  return (
    <LeadBot
      variant={variant}
      title="Property assistant"
      subtitle="Tell me what you need — I'll find it"
      launcherLabel="Find my property"
      messages={bot.messages}
      chips={bot.chips}
      multiSelect={Boolean(bot.step?.multi)}
      selectedChips={bot.selectedChips}
      confirmLabel={bot.selectedChips.length ? 'Continue' : 'Anywhere works'}
      onConfirm={bot.confirmMulti}
      onChip={bot.handleChip}
      onSend={bot.handleSend}
      inputMode={bot.step?.input === 'tel' ? 'tel' : 'text'}
      placeholder={
        bot.step?.placeholder || 'Ask me anything about these listings…'
      }
      loading={bot.loading}
      footer={
        completed ? (
          <div className="flex justify-center pt-1">
            {completed === 'buyer' ? accountCard : whatsappCard}
          </div>
        ) : undefined
      }
    />
  );
}
