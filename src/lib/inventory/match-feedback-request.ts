import type { MatchRejectReason } from '@/lib/match-feedback';
import type { ListingMatchFeedback } from '@/lib/inventory/match-feedback-store';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: string;
  } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error || 'Request failed');
  }
  return payload.data;
}

function post<T>(propertyId: string, body: unknown): Promise<T> {
  return call<T>(`/api/properties/${propertyId}/match-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchListingMatchFeedback(
  propertyId: string
): Promise<ListingMatchFeedback> {
  return call(`/api/properties/${propertyId}/match-feedback`);
}

export function fetchTypeSuggestions(
  contactIds: string[]
): Promise<Record<string, string>> {
  return call('/api/contacts/type-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactIds }),
  });
}

export function markMatchNotAFit(
  propertyId: string,
  contactId: string,
  reason: MatchRejectReason,
  propertyTypes: string[] = []
): Promise<{ typeSaved: boolean }> {
  return post(propertyId, {
    action: 'reject',
    contactId,
    reason,
    propertyTypes,
  });
}

export function saveMatchPropertyType(
  propertyId: string,
  contactId: string,
  propertyTypes: string[]
): Promise<{ typeSaved: boolean }> {
  return post(propertyId, { action: 'set_type', contactId, propertyTypes });
}

export function restoreMatch(
  propertyId: string,
  contactId: string
): Promise<{ restored: boolean }> {
  return call(
    `/api/properties/${propertyId}/match-feedback?contactId=${encodeURIComponent(contactId)}`,
    { method: 'DELETE' }
  );
}
