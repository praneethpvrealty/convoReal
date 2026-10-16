import { describe, expect, it } from 'vitest';

import {
  BROADCAST_MESSAGE_MAX,
  BROADCAST_UPDATE_BODY,
  BROADCAST_UPDATE_TEMPLATE_NAME,
  broadcastMessageProblem,
  broadcastTemplateBlockReason,
  buildBroadcastUpdateVariables,
  previewBroadcastUpdate,
  singleLineMessage,
} from './carrier-template';

describe('buildBroadcastUpdateVariables', () => {
  it('[BRC-001] greets per recipient and carries the agency and the message statically', () => {
    expect(
      buildBroadcastUpdateVariables(
        'Site visits at Lakeview open this weekend.',
        'Skyline Realty'
      )
    ).toEqual({
      '1': { type: 'field', value: 'name' },
      '2': { type: 'static', value: 'Skyline Realty' },
      '3': {
        type: 'static',
        value: 'Site visits at Lakeview open this weekend.',
      },
    });
  });

  it('[BRC-001] flattens whitespace so Meta never sees a newline in a param', () => {
    const variables = buildBroadcastUpdateVariables(
      'Open house\n\nSaturday  10 am\tto 5 pm.',
      '  Skyline\nRealty  '
    );
    expect(variables['3']).toEqual({
      type: 'static',
      value: 'Open house Saturday 10 am to 5 pm.',
    });
    expect(variables['2']).toEqual({ type: 'static', value: 'Skyline Realty' });
  });
});

describe('broadcastMessageProblem', () => {
  it('refuses a blank message, counting whitespace as blank', () => {
    expect(broadcastMessageProblem('')).toBe('empty');
    expect(broadcastMessageProblem(' \n\t ')).toBe('empty');
  });

  it('measures the flattened message against the cap', () => {
    expect(broadcastMessageProblem('x'.repeat(BROADCAST_MESSAGE_MAX))).toBe(
      null
    );
    expect(broadcastMessageProblem('x'.repeat(BROADCAST_MESSAGE_MAX + 1))).toBe(
      'too_long'
    );
    expect(
      broadcastMessageProblem(`${'x'.repeat(BROADCAST_MESSAGE_MAX)}\n\n\n`)
    ).toBe(null);
  });

  it('keeps the message inside the 1024-character body Meta allows', () => {
    const fixed = BROADCAST_UPDATE_BODY.replace(/\{\{\d\}\}/g, '').length;
    expect(fixed + 60 + 120 + BROADCAST_MESSAGE_MAX).toBeLessThanOrEqual(1024);
  });
});

describe('previewBroadcastUpdate', () => {
  it('[BRC-001] renders the recipient view with the sample name, the agency and the message', () => {
    const preview = previewBroadcastUpdate({
      message: 'Site visits open this weekend.',
      agencyName: 'Skyline Realty',
      contactName: 'Priya',
    });
    expect(preview).toContain(
      'Hello Priya, here is an update from Skyline Realty for you.'
    );
    expect(preview).toContain('\n\nSite visits open this weekend.\n\n');
    expect(preview).not.toMatch(/\{\{\d\}\}/);
  });

  it('falls back to a greeting and a placeholder before anything is typed', () => {
    const preview = previewBroadcastUpdate({
      message: '',
      agencyName: '',
      contactName: null,
    });
    expect(preview).toContain(
      'Hello there, here is an update from our team for you.'
    );
    expect(preview).toContain('Your message goes here.');
  });

  it('prefers the body Meta approved for the account over the shipped copy', () => {
    const preview = previewBroadcastUpdate({
      bodyText: 'Hi {{1}}, {{2}} says: {{3}}',
      message: 'Hello',
      agencyName: 'Acme',
      contactName: 'Ravi',
    });
    expect(preview).toBe('Hi Ravi, Acme says: Hello');
  });
});

describe('broadcastTemplateBlockReason', () => {
  const base = { rejectionReason: null, setupError: null } as const;

  it('[BRC-002] is clear once the row is approved and names the blocker otherwise', () => {
    expect(
      broadcastTemplateBlockReason({ ...base, status: 'APPROVED' })
    ).toBeNull();
    expect(broadcastTemplateBlockReason(null)).toBeNull();
    expect(
      broadcastTemplateBlockReason({ ...base, status: 'PENDING' })
    ).toMatch(/reviewing/);
    expect(
      broadcastTemplateBlockReason({
        status: 'REJECTED',
        rejectionReason: 'Too promotional',
        setupError: null,
      })
    ).toContain(
      `Too promotional. Resubmit it from Settings → Templates (${BROADCAST_UPDATE_TEMPLATE_NAME})`
    );
    expect(
      broadcastTemplateBlockReason({ ...base, status: 'PAUSED' })
    ).toContain('status: PAUSED');
  });

  it('[BRC-002] tells a disconnected account to connect WhatsApp rather than to wait', () => {
    expect(
      broadcastTemplateBlockReason({
        status: null,
        rejectionReason: null,
        setupError: 'whatsapp_not_connected',
      })
    ).toMatch(/Connect WhatsApp in Settings/);
    expect(
      broadcastTemplateBlockReason({
        status: null,
        rejectionReason: null,
        setupError: 'submission_failed',
      })
    ).toMatch(/retry/);
    expect(broadcastTemplateBlockReason({ ...base, status: null })).toMatch(
      /registering/
    );
  });
});

describe('singleLineMessage', () => {
  it('collapses every whitespace run to one space', () => {
    expect(singleLineMessage('  a \n\n b\t\tc  ')).toBe('a b c');
  });
});
