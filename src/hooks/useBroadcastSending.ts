'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import type { BroadcastTemplateState } from '@/lib/broadcasts/carrier-template';

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
 * What the composer sends. There is no template in it: the route
 * carries the message on the account's shared broadcast template and
 * fills the greeting name, the agency and the message itself.
 */
interface BroadcastPayload {
  name: string;
  message: string;
  audience: AudienceConfig;
  /** Narrow a Marketing send to contacts who explicitly opted in. */
  optedInOnly: boolean;
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

/**
 * The state of the template every hand-written broadcast rides on. An
 * account with no row yet gets one submitted to Meta here, on its own —
 * the agent never sees a template, only whether sends are unlocked —
 * and a pending row is re-read every half minute so approval unlocks
 * the composer without a reload.
 */
export function useBroadcastTemplate() {
  return useQuery({
    queryKey: ['broadcast-template'],
    queryFn: async ({ signal }) => {
      const read = async (method: 'GET' | 'POST') => {
        const res = await fetch('/api/broadcasts/template', {
          method,
          signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          data?: BroadcastTemplateState;
          error?: string;
        };
        if (!res.ok || !body.data) {
          throw new Error(body.error || 'Could not check broadcast setup');
        }
        return body.data;
      };
      const current = await read('GET');
      return current.status === null ? read('POST') : current;
    },
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' ? 30_000 : false,
    staleTime: 30_000,
  });
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
