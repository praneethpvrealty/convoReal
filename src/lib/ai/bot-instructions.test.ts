import { describe, expect, it } from 'vitest';
import { botInstructionPrompt } from './bot-instructions';

describe('botInstructionPrompt', () => {
  it('returns nothing when no rule matched', () => {
    expect(botInstructionPrompt([])).toBe('');
  });

  it('labels rules with their whitelisted influence', () => {
    const prompt = botInstructionPrompt([
      {
        id: 'rule-1',
        directive: 'Ask for the budget before offering a brochure.',
        influence: 'question_order',
      },
    ]);

    expect(prompt).toContain(
      '[question_order] Ask for the budget before offering a brochure.'
    );
    expect(prompt).toContain('must never initiate another message');
  });

  it('bounds prompt growth to twenty rules', () => {
    const prompt = botInstructionPrompt(
      Array.from({ length: 25 }, (_, index) => ({
        id: String(index),
        directive: `Rule ${index + 1}`,
        influence: 'tone' as const,
      }))
    );

    expect(prompt).toContain('20. [tone] Rule 20');
    expect(prompt).not.toContain('Rule 21');
  });
});
