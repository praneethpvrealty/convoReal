import { describe, expect, it } from 'vitest';
import { SPEC_DEFAULT_STAGES } from './default-stages';
import {
  dealStatusForStage,
  inferStageType,
  isBrokeragePaidStage,
  isBrokeragePendingStage,
  isLostStage,
  stageTypeOf,
  journeyStageKindForPipelineStage,
  needsBrokerageCapture,
  pipelineOutcomeForStage,
  startsClosingRecord,
  propertyStatusForPipelineStage,
  shouldCaptureBrokerage,
} from './stage-semantics';

describe('pipeline stage semantics', () => {
  it('keeps closed, collection, and paid stages in the successful outcome', () => {
    expect(pipelineOutcomeForStage('Deal Closed/Won')).toBe('successful');
    expect(pipelineOutcomeForStage('Closed/Registered/Won')).toBe('successful');
    expect(pipelineOutcomeForStage('Brokerage Pending')).toBe('successful');
    expect(pipelineOutcomeForStage('Brokerage Paid')).toBe('successful');
  });

  it('treats lost as a separate outcome', () => {
    expect(pipelineOutcomeForStage('Closed Lost')).toBe('lost');
    expect(dealStatusForStage('Closed Lost')).toBe('lost');
    expect(propertyStatusForPipelineStage('Closed Lost')).toBe('Available');
  });

  it('[PRP-015] keeps a listing under contract through negotiation and due diligence', () => {
    expect(propertyStatusForPipelineStage('Negotiation/Token')).toBe(
      'Under Contract'
    );
    expect(propertyStatusForPipelineStage('Due Diligence/Contract')).toBe(
      'Under Contract'
    );
    expect(propertyStatusForPipelineStage('Contract Signed')).toBe(
      'Under Contract'
    );
    expect(propertyStatusForPipelineStage('Deal Closed/Won')).toBe('Sold');
    expect(propertyStatusForPipelineStage('New Inquiry')).toBeNull();
    expect(propertyStatusForPipelineStage('Site Visit Scheduled')).toBeNull();
  });

  it('marks only brokerage paid as the terminal success stage', () => {
    expect(isBrokeragePaidStage('Brokerage Paid')).toBe(true);
    expect(isBrokeragePaidStage('Brokerage Pending')).toBe(false);
  });

  it('captures brokerage from negotiation through collection', () => {
    expect(shouldCaptureBrokerage('Negotiation/Token')).toBe(true);
    expect(shouldCaptureBrokerage('Due Diligence/Contract')).toBe(true);
    expect(shouldCaptureBrokerage('Brokerage Paid')).toBe(true);
    expect(shouldCaptureBrokerage('New Inquiry')).toBe(false);
  });

  it('[TXW-018] gives every pipeline stage the journey kind the mirror uses', () => {
    expect(journeyStageKindForPipelineStage('New Inquiry')).toBe('prospecting');
    expect(journeyStageKindForPipelineStage('Site Visit Scheduled')).toBe(
      'prospecting'
    );
    expect(journeyStageKindForPipelineStage('Negotiation/Token')).toBe(
      'closing'
    );
    expect(journeyStageKindForPipelineStage('Due Diligence/Contract')).toBe(
      'closing'
    );
    expect(journeyStageKindForPipelineStage('Deal Closed/Won')).toBe('won');
    expect(journeyStageKindForPipelineStage('Brokerage Pending')).toBe('won');
    expect(journeyStageKindForPipelineStage('Closed Lost')).toBe('lost');
  });

  it('[TXW-016] starts the closing record at the capture stage and never on a loss', () => {
    expect(startsClosingRecord('Negotiation/Token')).toBe(true);
    expect(startsClosingRecord('Due Diligence/Contract')).toBe(true);
    expect(startsClosingRecord('Deal Closed/Won')).toBe(true);
    expect(startsClosingRecord('Site Visit Scheduled')).toBe(false);
    expect(startsClosingRecord('Closed Lost')).toBe(false);
  });

  it('[TXW-016] pauses a move for brokerage only when none is recorded yet', () => {
    expect(
      needsBrokerageCapture({ brokerage_amount: null }, 'Negotiation/Token')
    ).toBe(true);
    expect(
      needsBrokerageCapture({ brokerage_amount: 0 }, 'Negotiation/Token')
    ).toBe(false);
    expect(
      needsBrokerageCapture({ brokerage_amount: null }, 'Site Visit')
    ).toBe(false);
  });
});

describe('[PRP-015] stage type decides what a stage means', () => {
  it('reads the stored type before the name', () => {
    const renamed = { name: 'Negotiation/Token', stage_type: 'open' };
    expect(stageTypeOf(renamed)).toBe('open');
    expect(propertyStatusForPipelineStage(renamed)).toBeNull();
    expect(shouldCaptureBrokerage(renamed)).toBe(false);
    expect(
      propertyStatusForPipelineStage({
        name: 'Anything',
        stage_type: 'committed',
      })
    ).toBe('Under Contract');
  });

  it('falls back to the name when no type is stored', () => {
    expect(stageTypeOf({ name: 'Brokerage Pending' })).toBe(
      'brokerage_pending'
    );
    expect(stageTypeOf({ name: 'Deal Closed/Won', stage_type: null })).toBe(
      'won'
    );
    expect(stageTypeOf({ name: 'Site Visit', stage_type: 'bogus' })).toBe(
      'open'
    );
  });

  it('gives the new default stages their meaning', () => {
    const byName = Object.fromEntries(
      SPEC_DEFAULT_STAGES.map((s) => [s.name, s])
    );
    const negotiation = byName["Owner's meeting → Negotiation"];
    expect(propertyStatusForPipelineStage(negotiation)).toBeNull();
    expect(needsBrokerageCapture({ brokerage_amount: null }, negotiation)).toBe(
      false
    );
    const confirmed = byName['Deal confirmed → Due diligence'];
    expect(propertyStatusForPipelineStage(confirmed)).toBe('Under Contract');
    expect(startsClosingRecord(confirmed)).toBe(true);
    expect(
      propertyStatusForPipelineStage(
        byName['Legal done → Agreement/Registration']
      )
    ).toBe('Under Contract');
    const registered = byName['Registered → Brokerage'];
    expect(isBrokeragePendingStage(registered)).toBe(true);
    expect(pipelineOutcomeForStage(registered)).toBe('successful');
    expect(isBrokeragePaidStage(byName['Brokerage paid / Closed'])).toBe(true);
    expect(isLostStage(byName['Closed Lost'])).toBe(true);
  });

  it('infers the same type from the name that each default stage stores', () => {
    for (const stage of SPEC_DEFAULT_STAGES) {
      if (stage.name === "Owner's meeting → Negotiation") continue;
      expect(inferStageType(stage.name)).toBe(stage.stage_type);
    }
  });
});
