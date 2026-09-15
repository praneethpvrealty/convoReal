export const JOURNEY_LIFECYCLE_STATUSES = [
  'active',
  'completed',
  'paused',
  'not_proceeding',
] as const;

export type JourneyLifecycleStatus =
  (typeof JOURNEY_LIFECYCLE_STATUSES)[number];
export type ClosedJourneyStatus = Exclude<JourneyLifecycleStatus, 'active'>;
export type JourneyOverviewMode = 'buyer' | 'property';

export const CLOSED_JOURNEY_STATUS_META: Record<
  ClosedJourneyStatus,
  { label: string; description: string }
> = {
  completed: {
    label: 'Completed successfully',
    description: 'The transaction concluded successfully.',
  },
  paused: {
    label: 'Paused — may return',
    description: 'The requirement is on hold but worth revisiting later.',
  },
  not_proceeding: {
    label: 'Not proceeding',
    description: 'The buyer changed direction or the requirement ended.',
  },
};

export const JOURNEY_CLOSURE_REASONS: Record<
  ClosedJourneyStatus,
  readonly string[]
> = {
  completed: ['Transaction completed', 'Brokerage received'],
  paused: [
    'Requirement on hold',
    'Budget or timing changed',
    'Waiting for a future opportunity',
  ],
  not_proceeding: [
    'Changed their mind',
    'Bought another property',
    'Location no longer suitable',
    'Budget mismatch',
    'Not responding',
  ],
};

export interface JourneyOverviewState {
  subject_id: string;
  lifecycle_status: JourneyLifecycleStatus;
  closure_reason: string | null;
  closed_at: string | null;
  archived_at: string | null;
  sort_order: number;
}

export function matchesJourneySearch(
  values: Array<string | null | undefined>,
  query: string
): boolean {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return true;
  const digits = term.replace(/\D/g, '');
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase();
  return (
    haystack.includes(term) ||
    Boolean(digits && haystack.replace(/\D/g, '').includes(digits))
  );
}

export type JourneyStateMutation =
  | {
      action: 'close';
      mode: JourneyOverviewMode;
      subjectId: string;
      status: ClosedJourneyStatus;
      reason: string;
    }
  | {
      action: 'reopen' | 'archive' | 'restore';
      mode: JourneyOverviewMode;
      subjectId: string;
    }
  | {
      action: 'reorder';
      mode: JourneyOverviewMode;
      subjectIds: string[];
    };

type ParseResult =
  { ok: true; value: JourneyStateMutation } | { ok: false; error: string };

function modeOf(value: unknown): JourneyOverviewMode | null {
  return value === 'buyer' || value === 'property' ? value : null;
}

function subjectOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseJourneyStateMutation(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid journey action' };
  }
  const input = raw as Record<string, unknown>;
  const mode = modeOf(input.mode);
  if (!mode) return { ok: false, error: 'Invalid journey mode' };

  if (input.action === 'reorder') {
    if (!Array.isArray(input.subjectIds)) {
      return { ok: false, error: 'subjectIds is required' };
    }
    const subjectIds = input.subjectIds.map(subjectOf);
    if (
      subjectIds.length === 0 ||
      subjectIds.length > 500 ||
      subjectIds.some((id) => !id) ||
      new Set(subjectIds).size !== subjectIds.length
    ) {
      return { ok: false, error: 'Invalid journey order' };
    }
    return { ok: true, value: { action: 'reorder', mode, subjectIds } };
  }

  const subjectId = subjectOf(input.subjectId);
  if (!subjectId) return { ok: false, error: 'subjectId is required' };

  if (
    input.action === 'reopen' ||
    input.action === 'archive' ||
    input.action === 'restore'
  ) {
    return { ok: true, value: { action: input.action, mode, subjectId } };
  }

  if (input.action !== 'close') {
    return { ok: false, error: 'Invalid journey action' };
  }
  const status = JOURNEY_LIFECYCLE_STATUSES.find(
    (candidate) => candidate === input.status && candidate !== 'active'
  ) as ClosedJourneyStatus | undefined;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!status) return { ok: false, error: 'Invalid closure outcome' };
  if (!reason) return { ok: false, error: 'Closure reason is required' };
  if (reason.length > 500) {
    return { ok: false, error: 'Closure reason is too long' };
  }
  return {
    ok: true,
    value: { action: 'close', mode, subjectId, status, reason },
  };
}
