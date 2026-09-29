import type { JourneyOverviewMode } from './overview-state';

export const JOURNEY_COMPARTMENTS = ['focus', 'passive'] as const;
export type JourneyCompartment = (typeof JOURNEY_COMPARTMENTS)[number];

export const JOURNEY_COMPARTMENT_SCOPES = ['team', 'agent'] as const;
export type JourneyCompartmentScope =
  (typeof JOURNEY_COMPARTMENT_SCOPES)[number];

export const DEFAULT_JOURNEY_COMPARTMENT: JourneyCompartment = 'passive';
export const DEFAULT_JOURNEY_COMPARTMENT_SCOPE: JourneyCompartmentScope =
  'team';

export interface JourneyCompartmentMutation {
  mode: JourneyOverviewMode;
  subjectId: string;
  compartment: JourneyCompartment;
}

export function isJourneyCompartmentScope(
  value: unknown
): value is JourneyCompartmentScope {
  return (
    typeof value === 'string' &&
    (JOURNEY_COMPARTMENT_SCOPES as readonly string[]).includes(value)
  );
}

export function journeyCompartmentScopeOf(
  value: unknown
): JourneyCompartmentScope {
  return isJourneyCompartmentScope(value)
    ? value
    : DEFAULT_JOURNEY_COMPARTMENT_SCOPE;
}

export function journeyCompartmentOwner(
  scope: JourneyCompartmentScope,
  userId: string
): string | null {
  return scope === 'agent' ? userId : null;
}

export function parseJourneyCompartmentMutation(
  raw: unknown
):
  | { ok: true; value: JourneyCompartmentMutation }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'mode, subjectId and compartment are required' };
  }
  const input = raw as Record<string, unknown>;
  const mode =
    input.mode === 'buyer' || input.mode === 'property' ? input.mode : null;
  if (!mode) return { ok: false, error: 'Invalid journey mode' };
  const subjectId =
    typeof input.subjectId === 'string' ? input.subjectId.trim() : '';
  if (!subjectId) return { ok: false, error: 'subjectId is required' };
  const compartment = input.compartment;
  if (
    typeof compartment !== 'string' ||
    !(JOURNEY_COMPARTMENTS as readonly string[]).includes(compartment)
  ) {
    return { ok: false, error: 'compartment must be focus or passive' };
  }
  return {
    ok: true,
    value: {
      mode,
      subjectId,
      compartment: compartment as JourneyCompartment,
    },
  };
}
