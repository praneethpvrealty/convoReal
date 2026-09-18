/**
 * The stages a fresh pipeline is seeded with. Shared by the pipelines
 * page (client seed on first visit) and the Journey → Deal conversion
 * route (server seed when an account converts before ever opening
 * Pipelines), so both seed the same board.
 */
export const SPEC_DEFAULT_STAGES = [
  { name: 'New Inquiry', color: '#3b82f6', position: 0 },
  { name: 'Profiling/Qualified', color: '#eab308', position: 1 },
  { name: 'Site Visit Scheduled', color: '#f97316', position: 2 },
  { name: 'Negotiation/Token', color: '#8b5cf6', position: 3 },
  { name: 'Due Diligence/Contract', color: '#06b6d4', position: 4 },
  { name: 'Deal Closed/Won', color: '#22c55e', position: 5 },
  { name: 'Brokerage Pending', color: '#f59e0b', position: 6 },
  { name: 'Brokerage Paid', color: '#16a34a', position: 7 },
  { name: 'Closed Lost', color: '#ef4444', position: 8 },
] as const;

export const DEFAULT_PIPELINE_NAME = 'Real Estate Pipeline';
