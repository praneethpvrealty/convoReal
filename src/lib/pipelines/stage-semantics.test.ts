import { describe, expect, it } from 'vitest';
import {
  dealStatusForStage,
  isBrokeragePaidStage,
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
