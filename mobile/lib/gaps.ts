import { apiFetch } from './api';
import type { ConversationGap } from './gaps-feed';

/**
 * Conversation gaps — the network half. Ordering and formatting live in
 * gaps-feed.ts, which stays importable by the test runner.
 */

export async function fetchGaps(): Promise<ConversationGap[]> {
  const body = await apiFetch<{ data: ConversationGap[] }>(
    '/api/sweep/gaps?status=open'
  );
  return body.data ?? [];
}

export async function closeGap(
  id: string,
  status: 'resolved' | 'dismissed'
): Promise<void> {
  await apiFetch(`/api/sweep/gaps/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}
