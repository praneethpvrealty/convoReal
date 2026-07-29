// ============================================================
// Scripted lead-bot funnels — step tables and the pure reducer that
// walks them. No React, no network, no AI: the conversation that
// captures a lead is deterministic, so it always completes, costs
// nothing per message, and is unit-testable. Free-form questions the
// visitor types mid-funnel are answered off to the side (catalog-qa /
// site-qa) without disturbing the step machine — the funnel resumes
// exactly where it paused.
// ============================================================

export type FunnelAnswers = Record<string, string | string[]>;

/** The funnel is complete — the caller submits the captured answers. */
export const FUNNEL_END = '__end__';
/** Hand the visitor over to the ConvoReal prospect funnel. */
export const FUNNEL_CRM = '__crm__';
/** Run the catalog match and show results before asking for contact details. */
export const FUNNEL_MATCH = '__match__';

export interface FunnelStep {
  id: string;
  ask: string;
  /** Tappable options. Chips and typing always coexist — a visitor who
   *  types "3BHK in Indiranagar" is answering just as validly. */
  chips?: string[];
  /** Chips built from the live catalog rather than the table. */
  chipsFrom?: 'categories' | 'localities';
  /** Chips accumulate until the visitor confirms. */
  multi?: boolean;
  input?: 'text' | 'tel';
  placeholder?: string;
  /** The visitor may move on without answering. */
  optional?: boolean;
  key: string;
  next: string | ((answer: string, answers: FunnelAnswers) => string);
}

export interface Funnel {
  id: 'showcase' | 'crm';
  first: string;
  steps: FunnelStep[];
}

export function funnelStep(funnel: Funnel, id: string): FunnelStep | null {
  return funnel.steps.find((s) => s.id === id) || null;
}

/**
 * Records an answer. Multi-select steps accumulate distinct values and
 * toggle a repeated one back off, so tapping a chip twice deselects it.
 */
export function recordAnswer(
  step: FunnelStep,
  answer: string,
  answers: FunnelAnswers
): FunnelAnswers {
  const value = answer.trim();
  if (!value) return answers;

  if (!step.multi) {
    return { ...answers, [step.key]: value };
  }

  const existing = answers[step.key];
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  const index = list.findIndex((v) => v.toLowerCase() === value.toLowerCase());
  const nextList =
    index >= 0 ? list.filter((_, i) => i !== index) : [...list, value];
  return { ...answers, [step.key]: nextList };
}

export function nextStepId(
  step: FunnelStep,
  answer: string,
  answers: FunnelAnswers
): string {
  return typeof step.next === 'function'
    ? step.next(answer.trim(), answers)
    : step.next;
}

/** Reads a multi-select answer as a list regardless of how it was captured. */
export function answerList(answers: FunnelAnswers, key: string): string[] {
  const value = answers[key];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

const QUESTION_SHAPE =
  /\?\s*$|^(what|which|whats|what's|how|why|when|where|who|is|are|do|does|did|can|could|would|should|any(thing)?|got|have you|tell me|show me)\b/i;

/**
 * Decides whether typed text is a question to answer rather than the
 * answer to the step being asked. Getting this wrong in the cautious
 * direction is cheap (the bot answers and re-asks); getting it wrong the
 * other way files "do you have plots?" as someone's name.
 *
 * A phone step is exempt: the visitor is there to give a number, and a
 * digit string is never a question.
 */
export function looksLikeQuestion(
  text: string,
  step: FunnelStep | null
): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  if (step?.input === 'tel' && /\d{5,}/.test(value)) return false;
  return QUESTION_SHAPE.test(value);
}

export function answerText(answers: FunnelAnswers, key: string): string {
  const value = answers[key];
  if (Array.isArray(value)) return value.join(', ');
  return value || '';
}
