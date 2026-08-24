import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractLoggedSummary,
  parsePropertyAnswer,
  PROPERTY_QUESTION_FINGERPRINT,
  PROPERTY_QUESTION_PROMPT,
} from './property-answer';

// Live: a client's forwarded reply was logged, the bot asked which
// property it was about, the agent typed "Prop-1194" — and the
// listing classifier read that as a brand-new listing and opened a
// draft with Title/Price/Location/Type all Missing. The response it
// was answering stayed unlinked.

describe('parsePropertyAnswer', () => {
  it('reads the code the agent actually typed', () => {
    expect(parsePropertyAnswer('Prop-1194')).toEqual({ code: 'PROP-1194' });
  });

  it.each([
    'PROP-1194',
    'prop 1194',
    'prop_1194',
    'It is PROP-1194',
    'PROP-1194 is the one',
  ])('%s', (text) => {
    expect(parsePropertyAnswer(text)).toEqual({ code: 'PROP-1194' });
  });

  it('accepts a listing name, which the prompt also invites', () => {
    expect(parsePropertyAnswer('Suraj Phoenix Jayanagar')).toEqual({
      title: 'Suraj Phoenix Jayanagar',
    });
  });

  it.each([
    // Anything long enough to be saying something else is not an answer.
    [
      'The client wants to visit on Sunday and asked whether the price on prop-1194 is negotiable',
    ],
    ['ok'],
    ['yes'],
    ['1194'],
    [''],
    [null],
    [undefined],
  ])('%s → not an answer', (text) => {
    expect(parsePropertyAnswer(text)).toBeNull();
  });

  // Live: the agent shared the property's Google Maps pin while this
  // question was still standing from hours earlier. It is 48 characters
  // of mostly letters, so it read as a listing NAME — answered "I
  // couldn't find https://maps.app.goo.gl/… in your inventory", twice,
  // while the pin never reached the draft the agent had open.
  it.each([
    ['https://maps.app.goo.gl/5zoGWBcgoyAMDJow7?g_st=iw'],
    ['https://maps.app.goo.gl/5zoGWBcgoyAMDJow7'],
    ['https://www.google.com/maps/search/?api=1&query=12.97,77.65'],
    ['www.99acres.com/some-listing'],
    ['Pin: https://maps.app.goo.gl/5zoGWBcgoyAMDJow7'],
  ])('%s → a link is not a listing name', (text) => {
    expect(parsePropertyAnswer(text)).toBeNull();
  });

  it('still reads the code out of a shared listing link', () => {
    // The prompt's own fallback invites "open the listing and share it
    // here", so a link that names the code is a real answer.
    expect(parsePropertyAnswer('/property/prop-1194-jayanagar')).toEqual({
      code: 'PROP-1194',
    });
  });
});

describe('the question and its fingerprint stay together', () => {
  it('finds the prompt that is actually sent', () => {
    expect(PROPERTY_QUESTION_FINGERPRINT.test(PROPERTY_QUESTION_PROMPT)).toBe(
      true
    );
  });

  it('does not match an ordinary bot message', () => {
    expect(
      PROPERTY_QUESTION_FINGERPRINT.test('✅ Logged Supreeth Kumar’s response')
    ).toBe(false);
  });

  it('asks for a typed code, not only a screenshot', () => {
    // The agent answered the old copy ("Forward a screenshot showing
    // the property name or code") by typing the code — the natural
    // reading, and the one the bot could not handle.
    expect(PROPERTY_QUESTION_PROMPT).toMatch(
      /reply with the property name or code/i
    );
  });
});

describe('extractLoggedSummary', () => {
  it('recovers what the client said from the logged note', () => {
    expect(
      extractLoggedSummary(
        '💬 Supreeth Kumar on PROP-1194: "The client followed up asking for an update on the property." (from forwarded chat)'
      )
    ).toBe('The client followed up asking for an update on the property.');
  });

  it('returns null for a note with no quoted summary, and for other notes', () => {
    expect(
      extractLoggedSummary('💬 Supreeth Kumar on PROP-1194: responded')
    ).toBeNull();
    expect(extractLoggedSummary('WhatsApp profile name: Supreeth')).toBeNull();
    expect(extractLoggedSummary(null)).toBeNull();
  });
});

// The reader is only useful if the engine consults it before the
// classifier, and only safe if the question it answers is registered
// against the message that asks it.
describe('the engine answers the question it asked', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/ai/chatbot-engine.ts'),
    'utf8'
  );

  it('reads a property answer before classifying the message', () => {
    const answer = source.indexOf('parsePropertyAnswer(cleanedText)');
    const classify = source.indexOf('await classifyImageOrText(');
    expect(answer).toBeGreaterThan(-1);
    expect(classify).toBeGreaterThan(-1);
    expect(answer).toBeLessThan(classify);
  });

  it('only completes when the bot’s own question is standing in the thread', () => {
    expect(source).toContain('latestBotTargetForPrompt({');
    expect(source).toContain('PROPERTY_QUESTION_FINGERPRINT');
  });

  it('registers the pending question against the message that asks it', () => {
    expect(source).toContain('outcome.pendingPropertyContactId');
    expect(source).toContain('completeClientResponseProperty({');
  });

  it('never claims a button tap — the label is not an answer', () => {
    // Live: the completion card's own "Today itself" reminder button
    // was read as a listing name and answered with "couldn't find
    // Today itself in your inventory", while the reminder never got
    // set. A tap carries its instruction in the id; the text is only
    // the label.
    expect(source).toContain('cleanedText && !isInteractiveTap');
  });

  it('yields to an open listing draft', () => {
    // The question stands for 48 hours. While it stands, every short
    // message reads as an answer to it — including the corrections and
    // the map pin the agent is sending into the draft they have open,
    // which is where the pin actually gets attached.
    expect(source).toContain(
      'cleanedText && !isInteractiveTap && !propSession) {\n    const propertyAnswer'
    );
  });

  it('retires the question once it is answered', () => {
    // Without this the question keeps standing for its 48-hour window
    // and every later short message re-answers it.
    const cleared = source.indexOf('clearBotTarget({');
    const fallbackText = source.indexOf("I couldn't find *${propertyAnswer.code");
    expect(cleared).toBeGreaterThan(-1);
    expect(fallbackText).toBeGreaterThan(-1);
    expect(cleared).toBeLessThan(fallbackText);
  });
});

describe('the capture hands the pending contact back', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/journey/client-response.ts'),
    'utf8'
  );

  it('reports which contact is waiting for its listing', () => {
    expect(source).toContain('pendingPropertyContactId: contact.id,');
  });

  it('runs the same journey link on the deferred answer as on the first pass', () => {
    // Both paths go through one function, so a late answer produces the
    // journey item, the event, the client ask and the deal notes — not
    // a thinner version of them.
    expect(source.match(/linkClientResponseToProperty\(/g)?.length).toBe(4);
  });
});
