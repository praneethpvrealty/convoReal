import { describe, expect, it } from 'vitest';
import {
  dealStatusForStage,
  isBrokeragePaidStage,
  pipelineOutcomeForStage,
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
});
