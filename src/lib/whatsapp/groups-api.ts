/**
 * Meta Cloud API — Groups.
 *
 * Separate from meta-api.ts for one concrete reason: the Groups
 * endpoints do not exist on v21.0, the version the rest of the client
 * pins. Bumping that constant would move every send, template and media
 * call to a version they have not been tested against, so groups carry
 * their own base and the rest of the integration is left alone.
 *
 * Two things about this API shape the callers:
 *
 *   1. Creation is asynchronous. POST /{phone}/groups answers with an
 *      invite link and a request id — NOT the group id. That arrives on
 *      the group_lifecycle_update webhook, so a caller cannot create a
 *      group and message it in the same request.
 *
 *   2. Pinning is real here. Unlike a 1:1 thread, a group pin is a Meta
 *      operation (type 'pin' on /messages), capped at three per group
 *      and expiring after 1-30 days, with the oldest auto-unpinned when
 *      a fourth is added.
 */

const META_GROUPS_API_VERSION = 'v23.0';
const META_GROUPS_API_BASE = `https://graph.facebook.com/${META_GROUPS_API_VERSION}`;

/** Meta's hard ceiling on group size. */
export const MAX_GROUP_PARTICIPANTS = 8;

/** Pins per group, and the window Meta will hold one for. */
export const MAX_GROUP_PINS = 3;
export const MIN_PIN_DAYS = 1;
export const MAX_PIN_DAYS = 30;

export interface GroupsAuth {
  phoneNumberId: string;
  accessToken: string;
}

async function groupsFetch<T>(
  path: string,
  accessToken: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${META_GROUPS_API_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      payload?.error?.message || `Meta Groups API error: ${response.status}`;
    // An OBA-ineligible number fails every one of these. Surfacing the
    // Meta message verbatim is what lets the caller tell "not eligible"
    // apart from "group is full".
    throw new Error(message);
  }
  return payload as T;
}

export interface CreateGroupResult {
  /** Shareable immediately — a group can be handed out before Meta has
   *  reported its id. */
  inviteLink: string;
  /** Correlates with the group_lifecycle_update webhook that carries
   *  the real group id. */
  requestId: string | null;
}

/**
 * Create a group. Returns the invite link and the request id; the group
 * id comes later on the webhook.
 */
export async function createGroup(
  auth: GroupsAuth,
  args: {
    subject: string;
    description?: string;
    joinApprovalMode?: 'off' | 'admin_approval';
  },
): Promise<CreateGroupResult> {
  const payload = await groupsFetch<{
    invite_link?: string;
    request_id?: string;
    groups?: { invite_link?: string; request_id?: string }[];
  }>(`/${auth.phoneNumberId}/groups`, auth.accessToken, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      subject: args.subject,
      ...(args.description ? { description: args.description } : {}),
      ...(args.joinApprovalMode
        ? { join_approval_mode: args.joinApprovalMode }
        : {}),
    },
  });

  const first = payload.groups?.[0];
  return {
    inviteLink: payload.invite_link ?? first?.invite_link ?? '',
    requestId: payload.request_id ?? first?.request_id ?? null,
  };
}

export interface GroupInfo {
  id: string;
  subject?: string;
  description?: string;
  participants?: { wa_id?: string; user_id?: string }[];
  total_participant_count?: number;
  join_approval_mode?: string;
  suspended?: boolean;
  creation_timestamp?: number;
}

const GROUP_FIELDS = [
  'id',
  'subject',
  'description',
  'participants',
  'total_participant_count',
  'join_approval_mode',
  'suspended',
  'creation_timestamp',
].join(',');

export function getGroup(
  accessToken: string,
  waGroupId: string,
): Promise<GroupInfo> {
  return groupsFetch<GroupInfo>(
    `/${waGroupId}?fields=${GROUP_FIELDS}`,
    accessToken,
  );
}

export function listGroups(
  auth: GroupsAuth,
  limit = 100,
): Promise<{ data?: GroupInfo[]; paging?: { cursors?: { after?: string } } }> {
  return groupsFetch(
    `/${auth.phoneNumberId}/groups?limit=${limit}`,
    auth.accessToken,
  );
}

/** Subject/description changes are confirmed by webhook, not the
 *  response — the call only reports that Meta accepted the request. */
export function updateGroup(
  accessToken: string,
  waGroupId: string,
  args: { subject?: string; description?: string },
): Promise<unknown> {
  return groupsFetch(`/${waGroupId}`, accessToken, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      ...(args.subject !== undefined ? { subject: args.subject } : {}),
      ...(args.description !== undefined
        ? { description: args.description }
        : {}),
    },
  });
}

export function deleteGroup(
  accessToken: string,
  waGroupId: string,
): Promise<unknown> {
  return groupsFetch(`/${waGroupId}`, accessToken, { method: 'DELETE' });
}

export async function getInviteLink(
  accessToken: string,
  waGroupId: string,
): Promise<string> {
  const payload = await groupsFetch<{ invite_link?: string }>(
    `/${waGroupId}/invite_link`,
    accessToken,
  );
  return payload.invite_link ?? '';
}

/** Rotates the link — anyone holding the old one can no longer join. */
export async function resetInviteLink(
  accessToken: string,
  waGroupId: string,
): Promise<string> {
  const payload = await groupsFetch<{ invite_link?: string }>(
    `/${waGroupId}/invite_link`,
    accessToken,
    { method: 'POST', body: { messaging_product: 'whatsapp' } },
  );
  return payload.invite_link ?? '';
}

/** There is no "add participant": people join by link. Removal is the
 *  only direction the business controls. */
export function removeParticipants(
  accessToken: string,
  waGroupId: string,
  waIds: string[],
): Promise<unknown> {
  return groupsFetch(`/${waGroupId}/participants`, accessToken, {
    method: 'DELETE',
    body: {
      messaging_product: 'whatsapp',
      participants: waIds.map((wa_id) => ({ user_id: wa_id })),
    },
  });
}

/**
 * Pin or unpin a message in a group — a real Meta operation, unlike the
 * Engine-local pin a 1:1 thread gets. Meta auto-unpins the oldest when a
 * fourth is added, so a caller does not have to make room first.
 */
export async function setGroupPin(
  auth: GroupsAuth,
  args: {
    waGroupId: string;
    /** Meta's wamid of the message being pinned. */
    messageId: string;
    pin: boolean;
    expirationDays?: number;
  },
): Promise<{ messageId: string | null }> {
  const days = Math.min(
    MAX_PIN_DAYS,
    Math.max(MIN_PIN_DAYS, args.expirationDays ?? 7),
  );

  const payload = await groupsFetch<{ messages?: { id: string }[] }>(
    `/${auth.phoneNumberId}/messages`,
    auth.accessToken,
    {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'group',
        to: args.waGroupId,
        type: 'pin',
        pin: args.pin
          ? {
              type: 'pin',
              message_id: args.messageId,
              expiration_days: String(days),
            }
          : { type: 'unpin', message_id: args.messageId },
      },
    },
  );
  return { messageId: payload.messages?.[0]?.id ?? null };
}
