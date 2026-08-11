import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Audience } from './chunks';
import type { CopilotPlatform, MobileCoverage } from './platform';

/**
 * Copilot adoption metering (copilot_events, migration 245).
 *
 * One row per interaction — a chat answer, a tour starting or
 * completing, a support ticket — tagged with platform and audience,
 * so "how many people use the copilot, where" is a GROUP BY instead
 * of a guess. The AI call log can't answer that: tour matches and
 * cache hits never call Gemini, and Guides-list tour starts never
 * reach the server at all without this.
 *
 * Fire-and-forget and best-effort, like unmet.ts: metering must
 * never slow down or break an answer, and a deployment that hasn't
 * applied the migration just logs a warning.
 */

export type CopilotEventKind =
  | 'chat'
  | 'tour_start'
  | 'tour_complete'
  | 'support_ticket';

export function logCopilotEvent(input: {
  accountId: string | null;
  userId?: string | null;
  audience?: Audience;
  platform?: CopilotPlatform;
  event: CopilotEventKind;
  tourId?: string | null;
  coverage?: MobileCoverage | null;
  cached?: boolean;
}): void {
  // A portal user with no agency link has nobody to attribute usage
  // to — skipped, same as unmet demand.
  if (!input.accountId) return;
  void supabaseAdmin()
    .from('copilot_events')
    .insert({
      account_id: input.accountId,
      user_id: input.userId ?? null,
      audience: input.audience ?? 'agent',
      platform: input.platform ?? 'web',
      event: input.event,
      tour_id: input.tourId ?? null,
      coverage: input.coverage ?? null,
      cached: input.cached ?? false,
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[Copilot events] log failed:', error.message);
      }
    });
}
