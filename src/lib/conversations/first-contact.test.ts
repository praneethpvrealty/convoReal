import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIRST_CONTACT_FILTER, LEAD_FORM_ROW_PREFIXES } from './first-contact';

const source = (path: string) =>
  readFileSync(join(process.cwd(), 'src', path), 'utf8');

describe('first contact on a lead thread', () => {
  it('[INB-055] still counts a filed inquiry or requirements form as the lead making contact', () => {
    expect(FIRST_CONTACT_FILTER.split(',')).toEqual([
      'sender_type.eq.customer',
      'message_id.like.web-inquiry-*',
      'message_id.like.ai-agent-inquiry-*',
      'message_id.like.web-requirements-*',
    ]);
    expect(source('lib/showcase/file-inquiry.ts')).toContain(
      "message_id: `${isAiAgent ? 'ai-agent' : 'web'}-inquiry-${Date.now()}`"
    );
    expect(source('app/api/public/requirements/route.ts')).toContain(
      'message_id: `web-requirements-${Date.now()}`'
    );
    expect(LEAD_FORM_ROW_PREFIXES).toHaveLength(3);
  });

  it('[INB-055] is what the webhook reads to decide a first inbound message', () => {
    const handler = source('lib/whatsapp/webhook-handler.ts');
    expect(handler).toContain(
      "import { FIRST_CONTACT_FILTER } from '@/lib/conversations/first-contact';"
    );
    expect(handler).toContain('.or(FIRST_CONTACT_FILTER)');
  });
});
