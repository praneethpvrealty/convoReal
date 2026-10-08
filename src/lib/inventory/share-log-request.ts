export type ShareLogChannel = 'whatsapp' | 'email';

export interface ShareLogRecipient {
  contact_id: string;
  classification?: string | null;
}

export interface ShareLogPayload {
  property_id: string;
  recipients: ShareLogRecipient[];
  channel?: ShareLogChannel;
  journey_visible?: boolean;
}

export interface ShareLogResponse {
  data?: { recorded?: number; failed?: string[] };
}

export interface ShareLogOutcome {
  recorded: number;
  complete: boolean;
  error: string | null;
}

export const SHARE_LOG_ATTEMPTS = 3;

function isRefusal(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

export async function postShareLog(
  post: (body: string) => Promise<ShareLogResponse | null | undefined>,
  payload: ShareLogPayload
): Promise<ShareLogOutcome> {
  const seen = new Set<string>();
  const recipients = payload.recipients.filter((r) => {
    if (!r.contact_id || seen.has(r.contact_id)) return false;
    seen.add(r.contact_id);
    return true;
  });
  if (recipients.length === 0) {
    return { recorded: 0, complete: true, error: null };
  }

  let pending = recipients;
  let recorded = 0;
  let error: string | null = null;
  for (let attempt = 0; attempt < SHARE_LOG_ATTEMPTS; attempt++) {
    let res: ShareLogResponse | null | undefined;
    try {
      res = await post(JSON.stringify({ ...payload, recipients: pending }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (isRefusal(err)) break;
      continue;
    }
    error = null;
    const count = Number(res?.data?.recorded);
    recorded += Number.isFinite(count) ? count : 0;
    const failed = new Set(
      Array.isArray(res?.data?.failed) ? res.data.failed : []
    );
    pending = pending.filter((r) => failed.has(r.contact_id));
    if (pending.length === 0) break;
  }

  const missing = recipients.length - recorded;
  if (missing <= 0) return { recorded, complete: true, error: null };
  return {
    recorded,
    complete: false,
    error:
      error ??
      `${missing} of ${recipients.length} share${recipients.length === 1 ? '' : 's'} could not be recorded`,
  };
}
