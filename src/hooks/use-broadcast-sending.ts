'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'contacts' | 'custom_field' | 'csv';
  tagIds?: string[];
  contactIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
export function useBroadcastSending(): UseBroadcastSendingReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const { user, accountId } = useAuth();

  async function createAndSendBroadcast(
    payload: BroadcastPayload
  ): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    try {
      if (!user || !accountId) {
        throw new Error('You are not signed in.');
      }

      setProgress(10);
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to trigger broadcast');
      }

      setProgress(100);
      return data.broadcastId;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}

export function useAudienceCount(
  audience: AudienceConfig | null,
  { optedInOnly = false }: { optedInOnly?: boolean } = {}
) {
  return useQuery({
    queryKey: ['broadcast-audience-count', audience, optedInOnly],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/broadcasts/audience-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, optedInOnly }),
        signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { count?: number };
        error?: string;
      };
      const count = body.data?.count;
      if (!res.ok || typeof count !== 'number') {
        throw new Error(body.error || 'Could not count the audience');
      }
      return count;
    },
    enabled: audience !== null,
    staleTime: 30_000,
  });
}
