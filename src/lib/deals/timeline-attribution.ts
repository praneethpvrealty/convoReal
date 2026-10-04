/**
 * Who a Transaction Workspace timeline entry is attributed to.
 *
 * A member's entry names the member, and a stakeholder's WhatsApp
 * acknowledgement names the stakeholder. Every other entry with no
 * member behind it (seeded checklists, imports, API calls, agent
 * scripts) reads "System", whatever free text its writer stored and
 * whatever source it carries, so the timeline never shows
 * "Claude (for …)" next to a separate "· system".
 *
 * Dependency-free: the mobile bundle imports this through `@shared/`,
 * and `src/lib/deals/events.ts` re-exports it.
 */

export interface TimelineAttributionInput {
  actor_id: string | null;
  actor_name: string | null;
  event_type: string;
  source: string;
}

export function timelineActorLabel(
  ev: TimelineAttributionInput
): string | null {
  const name = ev.actor_name?.trim() || null;
  if (ev.actor_id) return name;
  if (ev.event_type === 'update_acknowledged') return name;
  return 'System';
}

/** The source suffix after the actor, or null when it adds nothing. */
export function timelineSourceLabel(
  ev: Pick<TimelineAttributionInput, 'source'>
): string | null {
  return ev.source === 'mobile' || ev.source === 'api' ? ev.source : null;
}
