export type PipelineOutcome = 'active' | 'successful' | 'lost';

export const STAGE_TYPES = [
  'open',
  'committed',
  'won',
  'brokerage_pending',
  'brokerage_paid',
  'lost',
] as const;

export type StageType = (typeof STAGE_TYPES)[number];

export interface StageRef {
  name: string;
  stage_type?: string | null;
}

export type StageInput = StageRef | string;

function normalizedStageName(stageName: string): string {
  return stageName.trim().toLowerCase();
}

export function isStageType(value: unknown): value is StageType {
  return (
    typeof value === 'string' &&
    (STAGE_TYPES as readonly string[]).includes(value)
  );
}

export function inferStageType(stageName: string): StageType {
  const name = normalizedStageName(stageName);
  if (name.includes('lost')) return 'lost';
  if (name.includes('brokerage') && name.includes('paid')) {
    return 'brokerage_paid';
  }
  if (name.includes('brokerage')) return 'brokerage_pending';
  if (name.includes('won') || name.includes('registered')) return 'won';
  if (
    name.includes('negotiation') ||
    name.includes('token') ||
    name.includes('due diligence') ||
    name.includes('contract') ||
    name.includes('confirmed') ||
    name.includes('agreement')
  ) {
    return 'committed';
  }
  return 'open';
}

export function stageTypeOf(stage: StageInput): StageType {
  if (typeof stage === 'string') return inferStageType(stage);
  return isStageType(stage.stage_type)
    ? stage.stage_type
    : inferStageType(stage.name);
}

export function isLostStage(stage: StageInput): boolean {
  return stageTypeOf(stage) === 'lost';
}

export function isBrokeragePaidStage(stage: StageInput): boolean {
  return stageTypeOf(stage) === 'brokerage_paid';
}

export function isBrokeragePendingStage(stage: StageInput): boolean {
  return stageTypeOf(stage) === 'brokerage_pending';
}

export function pipelineOutcomeForStage(stage: StageInput): PipelineOutcome {
  const type = stageTypeOf(stage);
  if (type === 'lost') return 'lost';
  if (
    type === 'won' ||
    type === 'brokerage_pending' ||
    type === 'brokerage_paid'
  ) {
    return 'successful';
  }
  return 'active';
}

export function dealStatusForStage(stage: StageInput): 'open' | 'won' | 'lost' {
  const outcome = pipelineOutcomeForStage(stage);
  if (outcome === 'lost') return 'lost';
  if (outcome === 'successful') return 'won';
  return 'open';
}

export function propertyStatusForPipelineStage(
  stage: StageInput
): 'Available' | 'Under Contract' | 'Sold' | null {
  const outcome = pipelineOutcomeForStage(stage);
  if (outcome === 'lost') return 'Available';
  if (outcome === 'successful') return 'Sold';
  if (stageTypeOf(stage) === 'committed') return 'Under Contract';
  return null;
}

export function shouldCaptureBrokerage(stage: StageInput): boolean {
  return (
    pipelineOutcomeForStage(stage) === 'successful' ||
    stageTypeOf(stage) === 'committed'
  );
}

export type JourneyStageKind = 'prospecting' | 'closing' | 'won' | 'lost';

export function journeyStageKindForPipelineStage(
  stage: StageInput
): JourneyStageKind {
  const outcome = pipelineOutcomeForStage(stage);
  if (outcome === 'lost') return 'lost';
  if (outcome === 'successful') return 'won';
  if (shouldCaptureBrokerage(stage)) return 'closing';
  return 'prospecting';
}

export function startsClosingRecord(stage: StageInput): boolean {
  return shouldCaptureBrokerage(stage) && dealStatusForStage(stage) !== 'lost';
}

export function needsBrokerageCapture(
  deal: { brokerage_amount: number | null },
  stage: StageInput
): boolean {
  return deal.brokerage_amount === null && shouldCaptureBrokerage(stage);
}

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  open: 'In progress · listing available',
  committed: 'Confirmed · listing under contract',
  won: 'Won · listing sold',
  brokerage_pending: 'Won · brokerage pending',
  brokerage_paid: 'Brokerage paid',
  lost: 'Lost',
};
