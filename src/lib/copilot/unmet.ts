import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Audience } from './chunks';

/**
 * Unmet-demand log for the copilot.
 *
 * When the helper is asked for something ConvoReal cannot do, the
 * model names the missing capability in a short canonical phrase and
 * it lands in copilot_unmet_requests (migration 236). Aggregated
 * across tenants that is a ranked feature-request backlog collected
 * from the questions users were already asking.
 *
 * Clustering relies on the model's phrasing being canonical, so the
 * phrase is validated hard before it is stored: anything long,
 * sentence-shaped, or carrying PII is dropped rather than logged
 * under a key nothing else will ever match.
 *
 * Demand is recorded per audience as well as per account: an owner
 * asking for something is a different product signal from an agent
 * asking for it, and merging the two would misread the roadmap.
 *
 * Everything here is best-effort. A missing service key or an
 * unmigrated table must never break the chat reply the user is
 * waiting on.
 */

const EMAIL_RE = /\S+@\S+\.\S+/;
const LONG_DIGITS_RE = /\d{6,}/;
const MAX_CAPABILITY_CHARS = 80;
const MAX_CAPABILITY_WORDS = 10;
const MAX_QUESTION_CHARS = 500;

/** 'ability to export contacts' and 'export contacts' are one ask. */
const LEADING_FILLER_RE =
  /^(the )?(ability|option|support|a way|way|feature|possibility) (to|for) /;

export interface Capability {
  /** Display phrase, as written by the model. */
  capability: string;
  /** Normalized dedupe key — the unique constraint's other half. */
  key: string;
}

/**
 * Validates and normalizes a model-supplied capability phrase.
 * Returns null when the phrase is unusable as a grouping key.
 */
export function sanitizeCapability(raw: unknown): Capability | null {
  if (typeof raw !== 'string') return null;

  const capability = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:]+$/, '');

  if (capability.length < 3 || capability.length > MAX_CAPABILITY_CHARS) {
    return null;
  }
  if (EMAIL_RE.test(capability) || LONG_DIGITS_RE.test(capability)) return null;
  if (capability.split(' ').length > MAX_CAPABILITY_WORDS) return null;

  const key = capability
    .toLowerCase()
    .replace(LEADING_FILLER_RE, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!key) return null;

  return { capability, key };
}

/**
 * Records one unmet request. Fire-and-forget: repeat asks bump
 * request_count on the existing (account, capability) row.
 */
export function logUnmetRequest(input: {
  accountId: string;
  capability: Capability;
  question: string;
  pathname: string;
  audience?: Audience;
}): void {
  try {
    void supabaseAdmin()
      .rpc('log_copilot_unmet_request', {
        p_account_id: input.accountId,
        p_capability: input.capability.capability,
        p_capability_key: input.capability.key,
        p_question: input.question.slice(0, MAX_QUESTION_CHARS),
        p_pathname: input.pathname,
        p_audience: input.audience ?? 'agent',
      })
      .then(({ error }) => {
        if (error) console.warn('[Copilot unmet] log failed:', error.message);
      });
  } catch (err) {
    console.warn(
      '[Copilot unmet] log failed:',
      err instanceof Error ? err.message : err
    );
  }
}
