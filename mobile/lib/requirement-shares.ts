import { apiFetch } from '@/lib/api';

export type RequirementShareBox = 'received' | 'sent';
export type RequirementShareStatus =
  | 'sent'
  | 'viewed'
  | 'responded'
  | 'declined';

export interface RequirementBrief {
  reference: string;
  classification: string;
  requirements: string | null;
  noBudget: boolean;
  minBudget: number | null;
  maxBudget: number | null;
  areas: string[];
  projects: string[];
  propertyTypes: string[];
}

export interface RequirementShare {
  id: string;
  reference: string;
  brief: RequirementBrief;
  senderName: string | null;
  senderAccountName: string;
  recipientAccountId: string;
  recipientUserId: string;
  status: RequirementShareStatus;
  viewedAt: string | null;
  respondedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  responseCount: number;
}

export interface RequirementShareProperty {
  id: string;
  title: string;
  location: string | null;
  price: number | null;
  status: string | null;
}

export interface RequirementShareDetail {
  share: RequirementShare;
  properties: RequirementShareProperty[];
  responsePropertyIds: string[];
  responseProperties: RequirementShareProperty[];
}

export async function fetchRequirementShares(
  box: RequirementShareBox
): Promise<RequirementShare[]> {
  const response = await apiFetch<{ data: RequirementShare[] }>(
    `/api/requirement-account-shares?box=${box}`
  );
  return response.data;
}

export async function fetchRequirementShare(
  id: string
): Promise<RequirementShareDetail> {
  const response = await apiFetch<{ data: RequirementShareDetail }>(
    `/api/requirement-account-shares/${id}`
  );
  return response.data;
}

export async function respondToRequirementShare(
  id: string,
  propertyIds: string[],
  note: string
): Promise<void> {
  await apiFetch(`/api/requirement-account-shares/${id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ property_ids: propertyIds, note }),
  });
}

export async function declineRequirementShare(id: string): Promise<void> {
  await apiFetch(`/api/requirement-account-shares/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'decline' }),
  });
}

function money(value: number | null): string | null {
  if (!value) return null;
  if (value >= 10_000_000) {
    return `₹${(value / 10_000_000).toFixed(2).replace(/\.00$/, '')} Cr`;
  }
  if (value >= 100_000) {
    return `₹${(value / 100_000).toFixed(2).replace(/\.00$/, '')} L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function requirementBudget(brief: RequirementBrief): string {
  if (brief.noBudget) return 'No fixed budget';
  const min = money(brief.minBudget);
  const max = money(brief.maxBudget);
  if (min && max) return `${min}–${max}`;
  if (max) return `Up to ${max}`;
  if (min) return `Above ${min}`;
  return 'Budget not specified';
}

export function requirementShareStatus(status: RequirementShareStatus): string {
  if (status === 'viewed') return 'Viewed';
  if (status === 'responded') return 'Responded';
  if (status === 'declined') return 'Declined';
  return 'Delivered';
}
