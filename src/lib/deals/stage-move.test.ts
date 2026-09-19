import { describe, expect, it } from 'vitest';

import {
  BROKERAGE_INPUT_ERROR,
  brokerageColumns,
  parseBrokerageCapture,
} from './stage-move';

describe('[TXW-016] brokerage capture on a stage move', () => {
  it('accepts an absent brokerage and a well-formed one', () => {
    expect(parseBrokerageCapture({ status: 'open' })).toEqual({
      ok: true,
      value: null,
    });
    expect(
      parseBrokerageCapture({
        brokerage_type: 'percentage',
        brokerage_value: 1,
      })
    ).toEqual({
      ok: true,
      value: { brokerage_type: 'percentage', brokerage_value: 1 },
    });
  });

  it('rejects a half-given or non-positive brokerage', () => {
    for (const raw of [
      { brokerage_type: 'percentage' },
      { brokerage_value: 2 },
      { brokerage_type: 'flat', brokerage_value: 2 },
      { brokerage_type: 'fixed', brokerage_value: 0 },
      { brokerage_type: 'fixed', brokerage_value: '2' },
      { brokerage_type: 'fixed', brokerage_value: Number.NaN },
    ]) {
      expect(parseBrokerageCapture(raw)).toEqual({
        ok: false,
        error: BROKERAGE_INPUT_ERROR,
      });
    }
  });

  it('prices the brokerage from the deal value on the server', () => {
    expect(
      brokerageColumns(50_00_000, {
        brokerage_type: 'percentage',
        brokerage_value: 1,
      })
    ).toEqual({
      brokerage_type: 'percentage',
      brokerage_value: 1,
      brokerage_amount: 50_000,
    });
    expect(
      brokerageColumns('50000', {
        brokerage_type: 'fixed',
        brokerage_value: 75,
      })
    ).toEqual({
      brokerage_type: 'fixed',
      brokerage_value: 75,
      brokerage_amount: 75,
    });
  });
});
