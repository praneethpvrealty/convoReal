import { stageTypeOf, type StageRef } from '../pipelines/stage-semantics';
import type { DealFinancials } from './financials';
import type { DealMilestoneStatus } from './milestones';

export type ClosingPhase =
  'negotiation' | 'due_diligence' | 'agreement' | 'handover' | 'brokerage';

export const CLOSING_PHASES: ReadonlyArray<{
  id: ClosingPhase;
  label: string;
  keys: readonly string[];
}> = [
  {
    id: 'negotiation',
    label: 'Negotiation',
    keys: ['initial_negotiation', 'commercial_terms_agreed'],
  },
  {
    id: 'due_diligence',
    label: 'Due diligence',
    keys: [
      'token_paid',
      'documents_collected',
      'legal_verification',
      'loan_processing',
    ],
  },
  {
    id: 'agreement',
    label: 'Agreement & registration',
    keys: [
      'draft_agreement_shared',
      'agreement_executed',
      'conditions_precedent',
      'tds_and_instruments',
      'registration_scheduled',
      'sale_deed_registered',
    ],
  },
  { id: 'handover', label: 'Handover', keys: ['possession_handover'] },
  {
    id: 'brokerage',
    label: 'Brokerage & close',
    keys: ['brokerage_collected', 'deal_closed'],
  },
];

export const OTHER_MILESTONES_LABEL = 'Other milestones';

interface MilestoneLike {
  id: string;
  template_key: string | null;
  title: string;
  position: number;
  status: DealMilestoneStatus;
}

interface StageLike extends StageRef {
  id: string;
  position: number;
}

function isOpen(m: Pick<MilestoneLike, 'status'>): boolean {
  return m.status === 'pending' || m.status === 'in_progress';
}

export function closingPhaseOf(
  templateKey: string | null
): ClosingPhase | null {
  if (!templateKey) return null;
  return CLOSING_PHASES.find((p) => p.keys.includes(templateKey))?.id ?? null;
}

function phaseIndex(phase: ClosingPhase): number {
  return CLOSING_PHASES.findIndex((p) => p.id === phase);
}

/** How many closing phases a deal on this stage should already have
 *  finished. A stage reads "step done → step next", so a deal on
 *  "Legal done → Agreement" has finished negotiation and due diligence. */
export function phasesDoneForStage(stage: StageRef): number {
  const type = stageTypeOf(stage);
  const name = stage.name.toLowerCase();
  switch (type) {
    case 'lost':
    case 'open':
      return 0;
    case 'committed':
      return /agreement|registration|legal done/.test(name) ? 2 : 1;
    case 'won':
    case 'brokerage_pending':
      return 3;
    case 'brokerage_paid':
      return CLOSING_PHASES.length;
  }
}

/** Open standard milestones that belong to a phase the stage says is
 *  already finished. Reported, never fixed: completing them is the
 *  agent's call (TXW-003). */
export function milestonesBehindStage<M extends MilestoneLike>(
  milestones: readonly M[],
  stage: StageRef | null
): M[] {
  if (!stage) return [];
  const done = phasesDoneForStage(stage);
  return milestones
    .filter((m) => {
      if (!isOpen(m)) return false;
      const phase = closingPhaseOf(m.template_key);
      return phase !== null && phaseIndex(phase) < done;
    })
    .sort((a, b) => a.position - b.position);
}

/** Open milestones listed before this one — completing it now skips them. */
export function earlierOpenMilestones<M extends MilestoneLike>(
  milestones: readonly M[],
  target: Pick<MilestoneLike, 'id' | 'position'>
): M[] {
  return milestones
    .filter(
      (m) => m.id !== target.id && m.position < target.position && isOpen(m)
    )
    .sort((a, b) => a.position - b.position);
}

export function groupMilestonesByPhase<M extends MilestoneLike>(
  milestones: readonly M[]
): Array<{
  phase: ClosingPhase | null;
  label: string;
  items: M[];
  done: number;
}> {
  const sorted = [...milestones].sort((a, b) => a.position - b.position);
  const groups = CLOSING_PHASES.map((p) => ({
    phase: p.id as ClosingPhase | null,
    label: p.label,
    items: sorted.filter((m) => closingPhaseOf(m.template_key) === p.id),
    done: 0,
  }));
  groups.push({
    phase: null,
    label: OTHER_MILESTONES_LABEL,
    items: sorted.filter((m) => closingPhaseOf(m.template_key) === null),
    done: 0,
  });
  return groups
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, done: g.items.filter((m) => !isOpen(m)).length }));
}

/** The stage to offer once every milestone of the phase the current
 *  stage is working on is done. An offer only — the stage moves when
 *  the agent takes it. */
export function suggestedNextStage<S extends StageLike>(
  stages: readonly S[],
  current: S | null,
  milestones: readonly MilestoneLike[]
): S | null {
  if (!current || stageTypeOf(current) === 'lost') return null;
  const done = phasesDoneForStage(current);
  if (done >= CLOSING_PHASES.length) return null;
  if (stageTypeOf(current) === 'open' && !/negotiation/i.test(current.name)) {
    return null;
  }
  const phase = CLOSING_PHASES[done];
  const inPhase = milestones.filter((m) =>
    phase.keys.includes(m.template_key ?? '')
  );
  if (inPhase.length === 0 || inPhase.some(isOpen)) return null;
  return (
    [...stages]
      .sort((a, b) => a.position - b.position)
      .find(
        (s) =>
          s.position > current.position &&
          stageTypeOf(s) !== 'lost' &&
          phasesDoneForStage(s) > done
      ) ?? null
  );
}

export type MoneyMilestoneKey =
  'token_paid' | 'sale_deed_registered' | 'brokerage_collected';

/** The milestones that record money, and the Money fields they fill. */
export const MONEY_MILESTONES: Record<
  MoneyMilestoneKey,
  {
    amountField: keyof DealFinancials;
    amountLabel: string;
    dateField?: keyof DealFinancials;
    refField?: keyof DealFinancials;
  }
> = {
  token_paid: {
    amountField: 'token_amount',
    amountLabel: 'Token amount',
    dateField: 'token_received_at',
    refField: 'token_instrument_ref',
  },
  sale_deed_registered: {
    amountField: 'registered_consideration',
    amountLabel: 'Registered value',
  },
  brokerage_collected: {
    amountField: 'brokerage_received_amount',
    amountLabel: 'Brokerage received',
  },
};

export function isMoneyMilestone(
  templateKey: string | null
): templateKey is MoneyMilestoneKey {
  return Boolean(templateKey && templateKey in MONEY_MILESTONES);
}

/** Money milestones done on the checklist whose amount the Money tab
 *  has not recorded. */
export function moneyMissingForMilestones<M extends MilestoneLike>(
  milestones: readonly M[],
  financials: Partial<DealFinancials> | null
): M[] {
  if (!financials) return [];
  return milestones.filter(
    (m) =>
      m.status === 'completed' &&
      isMoneyMilestone(m.template_key) &&
      financials[MONEY_MILESTONES[m.template_key].amountField] == null
  );
}

/** Open money milestones whose amount the Money tab now holds. */
export function milestonesSettledByFinancials<M extends MilestoneLike>(
  milestones: readonly M[],
  financials: Partial<DealFinancials> | null
): M[] {
  if (!financials) return [];
  return milestones.filter(
    (m) =>
      isOpen(m) &&
      isMoneyMilestone(m.template_key) &&
      financials[MONEY_MILESTONES[m.template_key].amountField] != null
  );
}
