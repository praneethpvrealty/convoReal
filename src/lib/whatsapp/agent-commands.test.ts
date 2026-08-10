import { describe, it, expect } from 'vitest';
import { parseAgentCommand, buildBudgetCommandAck } from './agent-commands';

/**
 * The parser is the safety boundary. It runs on every agent message
 * in the inbox, and a false positive would swallow a real reply to a
 * lead instead of sending it — so ordinary prose containing a budget
 * must never parse, however close it reads to the command.
 */

describe('parseAgentCommand — budget', () => {
  it('reads a single figure as a ceiling, in crores and lakhs', () => {
    expect(parseAgentCommand('SET BUDGET 2CR')).toEqual({
      kind: 'budget',
      min: null,
      max: 20_000_000,
      none: false,
    });
    expect(parseAgentCommand('set budget 90 lakhs')?.max).toBe(9_000_000);
    expect(parseAgentCommand('Set Budget 1.5 crore')?.max).toBe(15_000_000);
  });

  it('reads a range however the agent punctuates it', () => {
    const expected = {
      kind: 'budget',
      min: 9_000_000,
      max: 12_000_000,
      none: false,
    };
    expect(parseAgentCommand('SET BUDGET 90L-1.2CR')).toEqual(expected);
    expect(parseAgentCommand('SET BUDGET 90L to 1.2cr')).toEqual(expected);
    expect(parseAgentCommand('SET BUDGET 90 lakh – 1.2 crore')).toEqual(
      expected
    );
  });

  it('orders a reversed range rather than saving min above max', () => {
    // "2cr to 90L" would otherwise store a range matching nothing.
    expect(parseAgentCommand('SET BUDGET 2cr to 90L')).toEqual({
      kind: 'budget',
      min: 9_000_000,
      max: 20_000_000,
      none: false,
    });
  });

  it('reads floors and explicit ceilings', () => {
    expect(parseAgentCommand('SET BUDGET above 90L')).toEqual({
      kind: 'budget',
      min: 9_000_000,
      max: null,
      none: false,
    });
    expect(parseAgentCommand('SET BUDGET under 2cr')?.max).toBe(20_000_000);
    expect(parseAgentCommand('SET BUDGET upto 2cr')?.max).toBe(20_000_000);
  });

  it('records "no fixed budget" as an answer', () => {
    expect(parseAgentCommand('SET BUDGET none')).toEqual({
      kind: 'budget',
      min: null,
      max: null,
      none: true,
    });
  });

  it('takes a bare small number as lakhs and a large one as rupees', () => {
    // "SET BUDGET 90" means 90 lakh to every agent in this market;
    // storing ₹90 would silently match nothing forever.
    expect(parseAgentCommand('SET BUDGET 90')?.max).toBe(9_000_000);
    expect(parseAgentCommand('SET BUDGET 8500000')?.max).toBe(8_500_000);
  });

  it('never swallows an ordinary reply to a lead', () => {
    for (const text of [
      'Sure, the budget for this one is 2cr',
      'Can you set budget expectations with the seller?',
      'what about 2 cr?',
      'budget 2cr',
      'SET BUDGET',
      'SET BUDGET soon',
      'SET PRICE 2cr',
    ]) {
      expect(parseAgentCommand(text), text).toBeNull();
    }
  });

  it('ignores a figure that is not a usable amount', () => {
    expect(parseAgentCommand('SET BUDGET 0')).toBeNull();
  });
});

describe('buildBudgetCommandAck', () => {
  it('says what was saved, what it matches, and that nothing was sent', () => {
    const ack = buildBudgetCommandAck(
      { kind: 'budget', min: null, max: 20_000_000, none: false },
      'Aryan Verma',
      3
    );
    expect(ack).toContain('Aryan Verma');
    expect(ack).toContain('up to ₹2 Cr');
    expect(ack).toContain('3 live listings');
    // The agent must never wonder whether the lead saw the command.
    expect(ack).toContain('Not sent to the contact');
  });

  it('is honest when nothing matches', () => {
    const ack = buildBudgetCommandAck(
      { kind: 'budget', min: null, max: null, none: true },
      null,
      0
    );
    expect(ack).toContain('no fixed budget');
    expect(ack).toContain('Nothing in live inventory matches yet');
  });
});
