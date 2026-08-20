// ============================================================
// Reading a thread for what the in-the-moment learners could not see.
//
// Two things need a model and cannot be had from shape alone:
//
//   1. A PROMISE. "I'll send the floor plan tonight" is only a gap
//      once you know nothing that followed was a floor plan, and both
//      halves of that are language. No regex survives contact with
//      how this actually gets typed.
//
//   2. FACTS spread across turns. chat-learning reads one bubble, so
//      a budget stated on Monday and a locality named on Wednesday
//      never meet. Here they do.
//
// The output goes nowhere near a record directly. Facts are handed to
// recordLearnedFacts, which re-applies the field whitelist, the
// bounds and the apply-vs-propose policy — this module's opinion
// about a field carries exactly as much weight as any other
// learner's, which is to say none. Gaps become observations a human
// reads. Nothing here writes.
// ============================================================

import { generateJson } from '@/lib/ai/gemini';
import { learnableFields } from '@/lib/learning/fields';
import { renderTranscript } from './transcript';
import type {
  DetectedGap,
  GapSeverity,
  SweepFact,
  SweepThread,
  ThreadFindings,
} from './types';

const AI_FEATURE = 'conversation_sweep_thread' as const;

/** More than this from one thread is a model listing everything it
 *  can think of rather than reporting what happened. */
const MAX_PROMISES = 2;
const MAX_FACTS = 8;

const SYSTEM = `You read one WhatsApp thread between an Indian real-estate broker and a client, and report only what the thread actually establishes.

You return TWO things.

1. facts — durable facts the CRM should hold about the CLIENT (what they want) or the PROPERTY discussed (its commercial terms). Only report a fact the thread STATES. Never infer a budget from a listing that was shared, never infer a location from where the broker is. Amounts are in rupees as plain integers: "1.2 cr" is 12000000, "85 lakh" is 8500000, "10.5k per sqft" is 10500.

2. promises — things the BROKER said they would do, which nothing later in the thread shows them doing. A promise needs a commitment ("I'll send", "will share by evening", "calling you tomorrow"), not a pleasantry. If the thread shows it being kept — the document arrives, the call is mentioned as having happened — it is NOT a promise to report. When in doubt, report nothing: a missed promise costs a line in a digest, an invented one sends a broker to chase a client who was never waiting.

Report nothing rather than guessing. An empty answer is a correct answer and the common one.`;

interface RawFact {
  entity?: string;
  field?: string;
  value?: unknown;
  evidence?: string;
}

interface RawPromise {
  summary?: string;
  evidence?: string;
  action?: string;
  overdue?: boolean;
}

interface RawFindings {
  facts?: RawFact[];
  promises?: RawPromise[];
}

/** JSON as a model returns it: sometimes fenced, sometimes prefaced. */
function parseJson(raw: string): RawFindings | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as RawFindings;
  } catch {
    return null;
  }
}

function buildPrompt(thread: SweepThread, transcript: string): string {
  const who = thread.contactName || 'the client';
  return [
    `Client: ${who}`,
    thread.propertyId
      ? 'A specific listing is under discussion; property facts attach to it.'
      : 'No specific listing is under discussion; do not report property facts.',
    '',
    'Transcript (oldest first):',
    transcript,
    '',
    'Contact fields you may report:',
    learnableFields('contact').join(', '),
    '',
    thread.propertyId
      ? `Property fields you may report:\n${learnableFields('property').join(', ')}`
      : '',
    '',
    'Return JSON exactly:',
    '{"facts":[{"entity":"contact"|"property","field":"<one of the fields above>","value":<number|string|boolean|array>,"evidence":"<the sentence it came from>"}],',
    ' "promises":[{"summary":"<what the broker said they would do, one line>","evidence":"<the broker\'s own sentence>","action":"<what to do now>","overdue":true|false}]}',
    '',
    'Both arrays may be empty.',
  ]
    .filter(Boolean)
    .join('\n');
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * A model's raw answer, reduced to what is safe to act on.
 *
 * Exported for tests: this is the gate between a model's imagination
 * and the review queue, and it should be provable without a network.
 */
export function sanitizeFindings(
  raw: RawFindings | null,
  thread: SweepThread,
  occurredAt: string
): ThreadFindings {
  const facts: SweepFact[] = [];
  const gaps: DetectedGap[] = [];
  if (!raw) return { facts, gaps };

  const allowed = {
    contact: new Set(learnableFields('contact')),
    property: new Set(learnableFields('property')),
  };

  for (const item of Array.isArray(raw.facts) ? raw.facts : []) {
    if (facts.length >= MAX_FACTS) break;
    const entity = item.entity === 'property' ? 'property' : 'contact';
    // A property fact with no listing to attach to has nowhere to go,
    // and guessing which of the account's listings it meant is how a
    // sweep reprices the wrong one.
    if (entity === 'property' && !thread.propertyId) continue;
    const field = cleanText(item.field, 60);
    if (!allowed[entity].has(field)) continue;
    if (item.value === null || item.value === undefined || item.value === '')
      continue;
    const evidence = cleanText(item.evidence, 500);
    if (!evidence) continue;
    facts.push({ entity, field, value: item.value, evidence });
  }

  for (const item of Array.isArray(raw.promises) ? raw.promises : []) {
    if (gaps.length >= MAX_PROMISES) break;
    const summary = cleanText(item.summary, 200);
    const evidence = cleanText(item.evidence, 500);
    if (!summary || !evidence) continue;
    const severity: GapSeverity = item.overdue === true ? 'high' : 'medium';
    gaps.push({
      kind: 'unkept_promise',
      severity,
      summary: thread.contactName
        ? `${thread.contactName}: ${summary}`
        : summary,
      evidence,
      suggestedAction:
        cleanText(item.action, 200) || 'Do it, or tell them when.',
      occurredAt,
      propertyId: thread.propertyId,
    });
  }

  return { facts, gaps };
}

export interface AnalyzeResult extends ThreadFindings {
  /** False when the call was skipped or failed, so the caller does not
   *  bill for a read that did not happen. */
  analyzed: boolean;
}

const EMPTY: AnalyzeResult = { facts: [], gaps: [], analyzed: false };

/**
 * One thread, read once.
 *
 * Never throws. The sweep runs unattended behind a cron, and one
 * thread whose model call times out must not cost an account its
 * whole morning's analysis — the caller counts the failure and moves
 * to the next thread.
 */
export async function analyzeThread(
  thread: SweepThread
): Promise<AnalyzeResult> {
  const transcript = renderTranscript(thread);
  if (!transcript) return EMPTY;

  const occurredAt =
    thread.messages[thread.messages.length - 1]?.createdAt ??
    new Date().toISOString();

  try {
    const raw = await generateJson(buildPrompt(thread, transcript), SYSTEM, {
      tier: 'standard',
      feature: AI_FEATURE,
    });
    const findings = sanitizeFindings(parseJson(raw), thread, occurredAt);
    return { ...findings, analyzed: true };
  } catch (err) {
    console.error('[sweep] thread analysis failed:', err);
    return EMPTY;
  }
}
