import type { StageType } from '@/lib/pipelines/stage-semantics';

/**
 * The stages a fresh pipeline is seeded with. Shared by the pipelines
 * page (client seed on first visit) and the Journey → Deal conversion
 * route (server seed when an account converts before ever opening
 * Pipelines), so both seed the same board. Each name reads as the step
 * just completed → the step it activates; `stage_type` carries what the
 * stage means, so renaming a stage never changes its behaviour.
 * `ensure_default_pipeline` in SQL seeds the same list.
 */
export const SPEC_DEFAULT_STAGES: ReadonlyArray<{
  name: string;
  color: string;
  position: number;
  stage_type: StageType;
}> = [
  {
    name: 'Enquiry → Shortlist',
    color: '#3b82f6',
    position: 0,
    stage_type: 'open',
  },
  {
    name: 'Shortlisted → Visit',
    color: '#eab308',
    position: 1,
    stage_type: 'open',
  },
  {
    name: "Finalised → Owner's meeting",
    color: '#f97316',
    position: 2,
    stage_type: 'open',
  },
  {
    name: "Owner's meeting → Negotiation",
    color: '#8b5cf6',
    position: 3,
    stage_type: 'open',
  },
  {
    name: 'Deal confirmed → Due diligence',
    color: '#06b6d4',
    position: 4,
    stage_type: 'committed',
  },
  {
    name: 'Legal done → Agreement/Registration',
    color: '#14b8a6',
    position: 5,
    stage_type: 'committed',
  },
  {
    name: 'Registered → Brokerage',
    color: '#f59e0b',
    position: 6,
    stage_type: 'brokerage_pending',
  },
  {
    name: 'Brokerage paid / Closed',
    color: '#16a34a',
    position: 7,
    stage_type: 'brokerage_paid',
  },
  { name: 'Closed Lost', color: '#ef4444', position: 8, stage_type: 'lost' },
];

export const DEFAULT_PIPELINE_NAME = 'Real Estate Pipeline';
