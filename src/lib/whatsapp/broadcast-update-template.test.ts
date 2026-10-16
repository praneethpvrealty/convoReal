import { describe, expect, it } from 'vitest';

import { validateTemplatePayload } from './template-validators';
import {
  BROADCAST_UPDATE_BODY,
  BROADCAST_UPDATE_FOOTER,
  BROADCAST_UPDATE_TEMPLATE_NAME,
} from '@/lib/broadcasts/carrier-template';
import {
  broadcastTemplateStateResponse,
  buildBroadcastUpdateTemplatePayload,
} from './broadcast-update-template';
import type { MessageTemplate } from '@/types';

describe('buildBroadcastUpdateTemplatePayload', () => {
  const payload = buildBroadcastUpdateTemplatePayload();

  it('[BRC-002] passes template validation with three body variables and no header', () => {
    expect(validateTemplatePayload(payload)).toEqual({
      bodyVarCount: 3,
      headerVarCount: 0,
    });
    expect(payload.header_type).toBeUndefined();
  });

  it('[BRC-002] is a Marketing text template under the shared name with the opt-out footer', () => {
    expect(payload.name).toBe(BROADCAST_UPDATE_TEMPLATE_NAME);
    expect(payload.category).toBe('Marketing');
    expect(payload.language).toBe('en_US');
    expect(payload.footer_text).toContain('STOP ALERTS');
    expect(payload.sample_values?.body).toHaveLength(3);
  });
});

describe('broadcastTemplateStateResponse', () => {
  it('previews the shipped copy until the account has a row', () => {
    expect(
      broadcastTemplateStateResponse(
        {
          status: null,
          template: null,
          rejectionReason: null,
          setupError: 'whatsapp_not_connected',
        },
        'Skyline Realty'
      )
    ).toEqual({
      status: null,
      rejectionReason: null,
      setupError: 'whatsapp_not_connected',
      bodyText: BROADCAST_UPDATE_BODY,
      footerText: BROADCAST_UPDATE_FOOTER,
      agencyName: 'Skyline Realty',
    });
  });

  it("previews the body Meta approved once the account's row exists", () => {
    const template = {
      body_text: 'Hi {{1}}, {{2}}: {{3}}',
      footer_text: null,
      status: 'APPROVED',
    } as unknown as MessageTemplate;
    const response = broadcastTemplateStateResponse(
      {
        status: 'APPROVED',
        template,
        rejectionReason: null,
        setupError: null,
      },
      'Acme'
    );
    expect(response.bodyText).toBe('Hi {{1}}, {{2}}: {{3}}');
    expect(response.footerText).toBeNull();
    expect(response.status).toBe('APPROVED');
  });
});
