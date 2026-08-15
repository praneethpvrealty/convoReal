import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEventOutcome } from '@/lib/calendar/event-outcome';

// A button tap carries its instruction in the id; the text is only the
// label. Twice now a label has been read by a free-text path that ran
// before the tap's own dispatcher — "📸 Send photos" as a forwarded
// client chat, "Today itself" as a listing name — so this suite pins
// the whole corridor at once: in the owner chatbot, every interpretive
// text reader between the top of the pipeline and the session blocks
// must be gated on isInteractiveTap, and the id dispatch must come
// first.

const source = readFileSync(
  join(process.cwd(), 'src/lib/ai/chatbot-engine.ts'),
  'utf8'
);

describe('tap labels never enter the interpretive corridor', () => {
  it('dispatches known button ids before every free-text reader', () => {
    const dispatch = source.indexOf(
      'buttonId?.startsWith(AGENT_FOLLOWUP_PREFIX)'
    );
    const firstReader = source.indexOf('parsePropertyAnswer(cleanedText)');
    expect(dispatch).toBeGreaterThan(-1);
    expect(firstReader).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(firstReader);
  });

  it.each([
    // Each reader, and the gate that keeps a label out of it.
    [
      'property answer',
      'cleanedText && !isInteractiveTap) {\n    const propertyAnswer',
    ],
    [
      'quote-correction',
      'cleanedText && !isInteractiveTap\n    ? await resolveBotTarget',
    ],
    ['event outcome', '!isInteractiveTap && parseEventOutcome(cleanedText)'],
    ['message replay', '!editTarget && !isInteractiveTap && !propSession'],
    [
      'scheduling intercept',
      '!isInteractiveTap && ((!propSession && !contactSession) || isDictatedTaskList',
    ],
  ])('%s is gated', (_name, marker) => {
    expect(source).toContain(marker);
  });

  it('derives the tap flag from the interactive type', () => {
    expect(source).toContain(
      "const isInteractiveTap = message.type === 'interactive';"
    );
  });
});

describe('why the outcome gate is load-bearing', () => {
  it.each([
    // Plausible button labels that satisfy the outcome regexes on
    // their own — with an appointment card standing in the thread, an
    // ungated tap with this label would cancel or complete it.
    ['Cancel', 'cancelled'],
    ['Done', 'completed'],
  ])('a bare "%s" label reads as an outcome', (label, status) => {
    expect(parseEventOutcome(label)?.status).toBe(status);
  });
});
