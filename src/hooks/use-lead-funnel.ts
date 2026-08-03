'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BotMessage } from '@/components/chat/lead-bot';
import {
  answerList,
  funnelStep,
  looksLikeQuestion,
  nextStepId,
  recordAnswer,
  type Funnel,
  type FunnelAnswers,
  type FunnelStep,
} from '@/lib/bot/funnel';

/** Handed to the caller's callbacks so they can talk back into the
 *  conversation without closing over the hook's own return value. */
export interface LeadFunnelApi {
  pushBot: (text: string, attachment?: ReactNode) => void;
  setLoading: (loading: boolean) => void;
  switchFunnel: (funnel: Funnel) => void;
}

interface UseLeadFunnelOptions {
  funnel: Funnel;
  /** Chips for steps that source them from live data. */
  chipsFor?: (source: NonNullable<FunnelStep['chipsFrom']>) => string[];
  /**
   * Called for a `next` that isn't a step id (FUNNEL_END, FUNNEL_ENGINE,
   * FUNNEL_MATCH). Return the step id to continue at, or null to stop
   * asking — the caller owns what happens next.
   */
  onSentinel: (
    sentinel: string,
    answers: FunnelAnswers,
    api: LeadFunnelApi
  ) => string | null;
  /** Free-form question the visitor typed instead of answering. */
  onQuestion: (
    question: string,
    answers: FunnelAnswers,
    api: LeadFunnelApi
  ) => Promise<void> | void;
}

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `m${messageSeq}`;
}

/**
 * Drives a scripted funnel over the chat shell: keeps the step machine,
 * the transcript, and the answers in sync, and lets a typed question
 * interrupt without losing the visitor's place in the script.
 */
export function useLeadFunnel({
  funnel: initialFunnel,
  chipsFor,
  onSentinel,
  onQuestion,
}: UseLeadFunnelOptions) {
  const [funnel, setFunnel] = useState(initialFunnel);
  const [stepId, setStepId] = useState<string | null>(initialFunnel.first);
  const [answers, setAnswers] = useState<FunnelAnswers>({});
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<BotMessage[]>(() => {
    const first = funnelStep(initialFunnel, initialFunnel.first);
    return first ? [{ id: nextMessageId(), role: 'bot', text: first.ask }] : [];
  });
  // The transcript is append-only, but a question mid-funnel needs the
  // answers as they stand right now, not as of the last render.
  const answersRef = useRef<FunnelAnswers>({});

  const step = stepId ? funnelStep(funnel, stepId) : null;

  const pushBot = useCallback((text: string, attachment?: ReactNode) => {
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'bot', text, attachment },
    ]);
  }, []);

  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'user', text },
    ]);
  }, []);

  const goTo = useCallback(
    (nextId: string | null) => {
      setStepId(nextId);
      if (!nextId) return;
      const next = funnelStep(funnel, nextId);
      if (next) pushBot(next.ask);
    },
    [funnel, pushBot]
  );

  // Set when a sentinel handler moves the machine itself, so the commit
  // that invoked it doesn't then overwrite the step it just set.
  const handedOverRef = useRef(false);

  /** Restarts the machine on another funnel (buyer → Engine prospect). */
  const switchFunnel = useCallback(
    (nextFunnel: Funnel) => {
      handedOverRef.current = true;
      setFunnel(nextFunnel);
      setStepId(nextFunnel.first);
      const first = funnelStep(nextFunnel, nextFunnel.first);
      if (first) pushBot(first.ask);
    },
    [pushBot]
  );

  const api = useMemo<LeadFunnelApi>(
    () => ({ pushBot, setLoading, switchFunnel }),
    [pushBot, switchFunnel]
  );

  const commit = useCallback(
    (current: FunnelStep, value: string, record = true) => {
      const updated = record
        ? recordAnswer(current, value, answersRef.current)
        : answersRef.current;
      answersRef.current = updated;
      setAnswers(updated);

      const target = nextStepId(current, value, updated);
      if (funnelStep(funnel, target)) {
        goTo(target);
        return;
      }
      handedOverRef.current = false;
      const resume = onSentinel(target, updated, api);
      if (handedOverRef.current) return;

      setStepId(resume);
      if (resume) {
        const next = funnelStep(funnel, resume);
        if (next) pushBot(next.ask);
      }
    },
    [api, funnel, goTo, onSentinel, pushBot]
  );

  const handleChip = useCallback(
    (chip: string) => {
      if (!step || loading) return;
      if (step.multi) {
        const updated = recordAnswer(step, chip, answersRef.current);
        answersRef.current = updated;
        setAnswers(updated);
        return;
      }
      pushUser(chip);
      commit(step, chip);
    },
    [commit, loading, pushUser, step]
  );

  /** Multi-select steps advance on the visitor's confirmation. The chip
   *  taps already recorded the selection, and recordAnswer toggles, so
   *  confirming must advance WITHOUT recording — otherwise the first
   *  selected chip is toggled straight back off and the step commits as
   *  if the visitor had skipped it. */
  const confirmMulti = useCallback(() => {
    if (!step || loading) return;
    const selected = answerList(answersRef.current, step.key);
    if (!selected.length && !step.optional) return;
    pushUser(selected.length ? selected.join(', ') : 'Anywhere works');
    commit(step, selected.join(', '), false);
  }, [commit, loading, pushUser, step]);

  const handleSend = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value || loading) return;
      pushUser(value);

      if (!step || looksLikeQuestion(value, step)) {
        setLoading(true);
        try {
          await onQuestion(value, answersRef.current, api);
        } finally {
          setLoading(false);
        }
        // Put the visitor back where they were — an unanswered step is
        // a dropped lead.
        if (step) pushBot(step.ask);
        return;
      }

      commit(step, value);
    },
    [api, commit, loading, onQuestion, pushBot, pushUser, step]
  );

  const chips = useMemo(() => {
    if (!step) return [];
    if (step.chips) return step.chips;
    if (step.chipsFrom && chipsFor) return chipsFor(step.chipsFrom);
    return [];
  }, [chipsFor, step]);

  return {
    step,
    messages,
    answers,
    chips,
    selectedChips: step?.multi ? answerList(answers, step.key) : [],
    loading,
    setLoading,
    pushBot,
    pushUser,
    handleChip,
    handleSend,
    confirmMulti,
    switchFunnel,
    goTo,
  };
}
