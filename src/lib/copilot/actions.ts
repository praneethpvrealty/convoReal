import type { EntityReference } from './entities';

export type CopilotActionType = 'complete_event' | 'share_property';
export type CopilotActionPlatform = 'web' | 'mobile';
export const COPILOT_APPOINTMENT_COMPLETED_EVENT =
  'copilot:appointment-completed';

interface CopilotActionBase {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
}

export type CopilotActionProposal =
  | (CopilotActionBase & {
      type: 'complete_event';
      entity: EntityReference & { kind: 'event' };
    })
  | (CopilotActionBase & {
      type: 'share_property';
      entity: EntityReference & { kind: 'property' };
      navigateTo: string;
    });

export type CopilotActionResolution =
  | {
      kind: 'proposal';
      type: CopilotActionType;
      entity: EntityReference;
    }
  | { kind: 'guidance'; reply: string };

export interface CopilotActionExecutionRequest {
  actionId: string;
  type: 'complete_event';
  entityId: string;
  platform: CopilotActionPlatform;
}

export interface CopilotActionExecutionResult {
  actionId: string;
  type: 'complete_event';
  entityId: string;
  status: 'completed';
  outcome: 'applied' | 'already_completed';
  replayed: boolean;
  executedAt: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isInstructionalQuestion(message: string): boolean {
  return /\b(?:how\s+(?:do|can|should)\s+i|how\s+to|show\s+me\s+how)\b/i.test(
    message
  );
}

function requestsCompletion(message: string): boolean {
  if (isInstructionalQuestion(message)) return false;
  return (
    /^\s*(?:\d+\s*[.)-]\s*)?(?:please\s+)?(?:mark|set)\b[\s\S]{0,240}\b(?:complete|completed|done|finished)\b/i.test(
      message
    ) ||
    /^\s*(?:\d+\s*[.)-]\s*)?(?:please\s+)?(?:complete|finish)\b/i.test(
      message
    ) ||
    /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:complete|finish)\b/i.test(
      message
    ) ||
    /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:mark|set)\b[\s\S]{0,240}\b(?:complete|completed|done|finished)\b/i.test(
      message
    ) ||
    /\bi\s+(?:want|need|would\s+like)\s+to\s+(?:complete|finish)\b/i.test(
      message
    ) ||
    /\bi\s+(?:want|need|would\s+like)\s+to\s+(?:mark|set)\b[\s\S]{0,240}\b(?:complete|completed|done|finished)\b/i.test(
      message
    )
  );
}

function requestsShare(message: string): boolean {
  const directShare =
    /^\s*(?:\d+\s*[.)-]\s*)?(?:please\s+)?(?:open\s*(?:\/|and)\s*)?(?:share|send|forward)\b/i.test(
      message
    );
  return (
    !isInstructionalQuestion(message) &&
    (directShare ||
      /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:share|send|forward)\b/i.test(
        message
      ) ||
      /\bi\s+(?:want|need|would\s+like)\s+to\s+(?:share|send|forward)\b/i.test(
        message
      ))
  );
}

function oneEntity(
  entities: EntityReference[],
  kind: EntityReference['kind'],
  missingReply: string,
  multipleReply: string
): CopilotActionResolution {
  const matches = entities.filter((entity) => entity.kind === kind);
  if (matches.length === 0) return { kind: 'guidance', reply: missingReply };
  if (matches.length > 1) return { kind: 'guidance', reply: multipleReply };
  return {
    kind: 'proposal',
    type: kind === 'event' ? 'complete_event' : 'share_property',
    entity: matches[0],
  };
}

export function resolveCopilotAction(
  message: string,
  entities: EntityReference[]
): CopilotActionResolution | null {
  const complete = requestsCompletion(message);
  const hasSelectedProperty = entities.some(
    (entity) => entity.kind === 'property'
  );
  const hasSelectedEvent = entities.some((entity) => entity.kind === 'event');
  const namesProperty = /\b(?:property|properties|listing|listings)\b/i.test(
    message
  );
  const share =
    requestsShare(message) &&
    (hasSelectedProperty || (namesProperty && !hasSelectedEvent));
  if (!complete && !share) return null;
  if (complete && share) {
    return {
      kind: 'guidance',
      reply:
        'I can prepare one confirmed action at a time. First complete the calendar event, then ask me to share the property.',
    };
  }
  if (complete) {
    return oneEntity(
      entities,
      'event',
      'Select one calendar event with &, then ask me to mark it completed.',
      'Choose one calendar event at a time so I do not complete the wrong one.'
    );
  }
  return oneEntity(
    entities,
    'property',
    'Select one property with #, then ask me to share it.',
    'Choose one property at a time so I open the right share flow.'
  );
}

export function buildCopilotActionProposal(
  resolution: Extract<CopilotActionResolution, { kind: 'proposal' }>,
  actionId: string
): CopilotActionProposal {
  if (resolution.type === 'complete_event') {
    return {
      id: actionId,
      type: 'complete_event',
      entity: { ...resolution.entity, kind: 'event' },
      title: `Mark &${resolution.entity.label} completed?`,
      description:
        'This changes the calendar status and stops pending reminders for this event.',
      confirmLabel: 'Mark completed',
    };
  }
  return {
    id: actionId,
    type: 'share_property',
    entity: { ...resolution.entity, kind: 'property' },
    title: `Share #${resolution.entity.label}?`,
    description:
      'I will open the share flow. No message is sent until you choose recipients and confirm it there.',
    confirmLabel: 'Continue to share',
    navigateTo: `/inventory?sharePropertyId=${encodeURIComponent(
      resolution.entity.id
    )}&copilotAction=${encodeURIComponent(actionId)}`,
  };
}

export function readCopilotActionExecutionRequest(
  raw: unknown
): CopilotActionExecutionRequest | { error: string } {
  const body = (raw ?? {}) as {
    actionId?: unknown;
    type?: unknown;
    entityId?: unknown;
    platform?: unknown;
  };
  if (!isUuid(body.actionId) || !isUuid(body.entityId)) {
    return { error: 'actionId and entityId must be valid UUIDs' };
  }
  if (body.type !== 'complete_event') {
    return { error: 'Unsupported Copilot action' };
  }
  if (body.platform !== 'web' && body.platform !== 'mobile') {
    return { error: 'platform must be web or mobile' };
  }
  return {
    actionId: body.actionId,
    type: body.type,
    entityId: body.entityId,
    platform: body.platform,
  };
}
