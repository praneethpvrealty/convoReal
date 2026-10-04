import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'src/lib/ai/chatbot-engine.ts'),
  'utf8'
);

describe('chatbot-engine draft session access', () => {
  it('reaches the draft session tables only through draft-sessions', () => {
    expect(source).not.toContain(".from('property_draft_sessions')");
    expect(source).not.toContain(".from('contact_draft_sessions')");
    expect(source).toMatch(/from '@\/lib\/ai\/draft-sessions';/);
  });

  it('keeps no hand-rolled optimistic-lock loop', () => {
    expect(source).not.toContain('maxRetries');
    expect(source).not.toContain("code === 'PGRST116'");
  });
});
