import { describe, expect, it } from 'vitest';

import {
  buildConversionDeal,
  conversionTitle,
  defaultStageForConversion,
  parseConversionInput,
  type ConvertibleJourneyItem,
} from './conversion';

const stages = [
  { id: 's0', name: 'New Inquiry', position: 0 },
  { id: 's3', name: 'Negotiation/Token', position: 3 },
  { id: 's4', name: 'Due Diligence/Contract', position: 4 },
  { id: 's5', name: 'Deal Closed/Won', position: 5 },
];

const item: ConvertibleJourneyItem = {
  id: 'item-1',
  contact_id: 'c1',
  property_id: 'p1',
  stage_id: 'js-token',
  status: 'active',
  contact: { name: 'Adithi', phone: '+919999999999' },
  property: { title: 'JP Nagar plot', unit_no: '19', price: 16200000 },
};

describe('[TXW-001] journey → deal conversion', () => {
  it('lands a closing journey on the board’s token/negotiation stage', () => {
    expect(defaultStageForConversion(stages, 'closing')?.id).toBe('s3');
    expect(defaultStageForConversion(stages, 'won')?.id).toBe('s3');
  });

  it('starts a prospecting journey at the first stage', () => {
    expect(defaultStageForConversion(stages, 'prospecting')?.id).toBe('s0');
    expect(defaultStageForConversion([], 'closing')).toBeNull();
  });

  it('never picks a terminal stage even when nothing else matches', () => {
    const board = [
      { id: 'a', name: 'Lead', position: 0 },
      { id: 'b', name: 'Deal Closed/Won', position: 1 },
    ];
    expect(defaultStageForConversion(board, 'closing')?.id).toBe('a');
  });

  it('skips terminal stages that a reordered board puts first', () => {
    const board = [
      { id: 'lost', name: 'Closed Lost', position: 0 },
      { id: 'won', name: 'Deal Closed/Won', position: 1 },
      { id: 'paid', name: 'Brokerage Paid', position: 2 },
      { id: 'visit', name: 'Site Visit Scheduled', position: 3 },
    ];
    expect(defaultStageForConversion(board, 'prospecting')?.id).toBe('visit');
    expect(defaultStageForConversion(board, 'closing')?.id).toBe('visit');
    expect(
      defaultStageForConversion(
        [{ id: 'won', name: 'Deal Closed/Won', position: 0 }],
        'closing'
      )
    ).toBeNull();
  });

  it('builds the deal row with provenance and the property price as value', () => {
    expect(
      buildConversionDeal({
        item,
        accountId: 'acc',
        userId: 'u1',
        pipelineId: 'pipe',
        stageId: 's3',
      })
    ).toEqual({
      account_id: 'acc',
      user_id: 'u1',
      pipeline_id: 'pipe',
      stage_id: 's3',
      contact_id: 'c1',
      property_id: 'p1',
      title: 'Adithi — Property No. 19',
      value: 16200000,
      currency: 'INR',
      status: 'open',
      source_journey_item_id: 'item-1',
    });
  });

  it('titles fall back from unit number to title, and from name to phone', () => {
    expect(
      conversionTitle({
        ...item,
        contact: { name: null, phone: '+919999999999' },
        property: { title: 'JP Nagar plot', unit_no: null, price: null },
      })
    ).toBe('+919999999999 — JP Nagar plot');
    expect(conversionTitle({ ...item, contact: null, property: null })).toBe(
      'Buyer — Property'
    );
  });

  it('parses the request body', () => {
    expect(
      parseConversionInput({ item_id: ' item-1 ', source: 'mobile' })
    ).toEqual({
      ok: true,
      value: {
        itemId: 'item-1',
        pipelineId: null,
        title: null,
        source: 'mobile',
      },
    });
    expect(parseConversionInput({})).toEqual({
      ok: false,
      error: 'item_id is required',
    });
  });
});
