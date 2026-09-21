const MAX_RETRY_WAIT_MS = 70_000;

export interface SharePropertyRequestBody {
  contact_id: string;
  property_id: string;
  message: string;
  header_image?: string;
}

export interface SharePropertyResult {
  ok: boolean;
  status: number;
  data?: { sent?: boolean; channel?: string; template_status?: string };
  error?: string;
}

type Attempt = SharePropertyResult & { retryAfterSec?: number };

export async function postPropertyShare(
  body: SharePropertyRequestBody,
  deps: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<SharePropertyResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempt = async (): Promise<Attempt> => {
    const response = await fetchImpl('/api/whatsapp/share-property', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: SharePropertyResult['data'];
      error?: string;
      retry_after_seconds?: number;
    } | null;
    if (response.status === 429) {
      const hinted = Number(payload?.retry_after_seconds);
      return {
        ok: false,
        status: 429,
        error: 'Rate limit exceeded',
        retryAfterSec: Number.isFinite(hinted) && hinted > 0 ? hinted : 60,
      };
    }
    return {
      ok: response.ok,
      status: response.status,
      data: payload?.data,
      ...(response.ok ? {} : { error: payload?.error || 'Send failed' }),
    };
  };
  const first = await attempt();
  if (first.status !== 429) return first;
  await sleep(Math.min((first.retryAfterSec ?? 60) * 1000, MAX_RETRY_WAIT_MS));
  const second = await attempt();
  return {
    ok: second.ok,
    status: second.status,
    data: second.data,
    ...(second.error ? { error: second.error } : {}),
  };
}
