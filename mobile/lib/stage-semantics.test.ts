import { describe, expect, it } from 'vitest';
import { propertyStatusForPipelineStage } from './stage-semantics';

describe('propertyStatusForPipelineStage', () => {
  it('[PRP-015] keeps a listing under contract through negotiation and due diligence', () => {
    expect(propertyStatusForPipelineStage('Negotiation/Token')).toBe(
      'Under Contract'
    );
    expect(propertyStatusForPipelineStage('Due Diligence/Contract')).toBe(
      'Under Contract'
    );
    expect(propertyStatusForPipelineStage('Deal Closed/Won')).toBe('Sold');
    expect(propertyStatusForPipelineStage('Closed Lost')).toBe('Available');
    expect(propertyStatusForPipelineStage('New Inquiry')).toBeNull();
  });
});
