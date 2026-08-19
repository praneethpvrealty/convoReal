import { describe, expect, it } from 'vitest';

import {
  buildPersonalWhatsAppJourneyMetadata,
  cleanJourneyMessage,
  inferPersonalWhatsAppJourneyMessage,
  personalJourneyDedupeKey,
} from './personal-whatsapp-events';

describe('personal WhatsApp journey helpers', () => {
  it('normalizes journey log text consistently', () => {
    expect(
      cleanJourneyMessage('  Hi,\n  all  \n  teams!   '),
    ).toBe('Hi, all teams!');
  });

  it('produces deterministic dedupe keys with sender + source', () => {
    const key = personalJourneyDedupeKey({
      itemId: 'ji-1',
      message: 'Hello',
      source: 'web',
      senderId: null,
    });
    expect(key.length).toBe(64);
    expect(key).toBe(
      'df2a8390895df9a815bb52e571a35ec37a4c6e4ec7b37808dd04147fa1871270',
    );
  });

  it('derives message fallbacks for send types without payloads', () => {
    expect(
      inferPersonalWhatsAppJourneyMessage({
        contentType: 'template',
        contentText: '',
        templateName: 'check_in',
      }),
    ).toBe('[template:check_in]');

    expect(
      inferPersonalWhatsAppJourneyMessage({
        contentType: 'interactive',
        contentText: null,
        templateName: null,
      }),
    ).toBe('[interactive]');

    expect(
      inferPersonalWhatsAppJourneyMessage({
        contentType: 'media',
        contentText: null,
        templateName: null,
      }),
    ).toBe('[media]');
  });

  it('builds journey metadata with sender/channel fields', () => {
    expect(
      buildPersonalWhatsAppJourneyMetadata({
        source: 'mobile',
        senderType: 'agent',
        senderId: 'user-1',
        itemId: 'ji-1',
        contactId: 'c-1',
        propertyId: null,
        conversationId: 'conv-1',
        message: 'Hi there',
      }),
    ).toMatchObject({
      channel: 'personal_whatsapp',
      source: 'mobile',
      sender_type: 'agent',
      sender_id: 'user-1',
      item_id: 'ji-1',
      contact_id: 'c-1',
      property_id: null,
      conversation_id: 'conv-1',
      message: 'Hi there',
      message_length: 8,
    });
  });
});
