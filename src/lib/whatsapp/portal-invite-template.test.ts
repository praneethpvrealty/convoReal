import { describe, expect, it } from 'vitest';

import { LANGUAGE_CODES } from '@/lib/languages';
import {
  buildPortalAgentInviteTemplatePayload,
  buildPortalInviteFallbackSelection,
  buildPortalInviteTemplateParams,
  buildPortalInviteTemplatePayload,
  PORTAL_AGENT_INVITE_TEMPLATE_NAME,
  PORTAL_INVITE_TEMPLATE_NAME,
  portalInviteTemplateName,
} from './portal-invite-template';
import {
  PORTAL_INVITE_PHRASES_BY_KEY,
  portalInvitePhrase,
  templateBody,
} from './template-copy';
import { validateTemplatePayload } from './template-validators';

describe('portal invite templates', () => {
  it('[CTM-002] are valid Marketing templates whose one button opens the attributed portal link', () => {
    for (const build of [
      buildPortalInviteTemplatePayload,
      buildPortalAgentInviteTemplatePayload,
    ]) {
      const payload = build('https://www.convoreal.com/');
      expect(() => validateTemplatePayload(payload)).not.toThrow();
      expect(payload.category).toBe('Marketing');
      expect(payload.footer_text).toBe('Reply STOP to unsubscribe');
      expect(payload.buttons).toEqual([
        {
          type: 'URL',
          text: 'Open the portal',
          url: 'https://www.convoreal.com/{{1}}',
          example: '?ref=account-id&v=contact-id',
        },
      ]);
    }
    expect(buildPortalInviteTemplatePayload('https://x.test').name).toBe(
      PORTAL_INVITE_TEMPLATE_NAME
    );
    expect(buildPortalAgentInviteTemplatePayload('https://x.test').name).toBe(
      PORTAL_AGENT_INVITE_TEMPLATE_NAME
    );
    expect(portalInviteTemplateName('buyer')).toBe(PORTAL_INVITE_TEMPLATE_NAME);
    expect(portalInviteTemplateName('agent')).toBe(
      PORTAL_AGENT_INVITE_TEMPLATE_NAME
    );
  });

  it('[CTM-002] tells a buyer to filter, shortlist and enquire from the portal, and a co-broker about agent view', () => {
    const buyer = buildPortalInviteTemplatePayload('https://x.test').body_text;
    expect(buyer).toContain('property portal');
    expect(buyer).toContain('shortlist');
    expect(buyer).toContain('send the enquiry from the portal');
    expect(buyer).not.toContain('selected these properties');

    const agent =
      buildPortalAgentInviteTemplatePayload('https://x.test').body_text;
    expect(agent).toContain('agent view');
    expect(agent).toContain('your own share link');
    expect(agent).toContain('full inventory');
  });

  it('[CTM-002] keeps the worst-case rendered body inside the 1024-character cap in every language', () => {
    const longest = buildPortalInviteTemplateParams({
      contactName: 'Venkatanarasimharajuvaripeta Subrahmanyeshwara Rao',
      agentName: 'Lakshminarayana Venkataramana Subramanian',
      brandName: 'Aryavarta Ventures Property Consultants Private Limited',
      scope:
        'independent house or villa for sale in Sarjapur Road near Wipro Corporate Office and Dommasandra Circle',
      audience: 'buyer',
    });
    for (const key of ['portal_invite', 'portal_invite_agent'] as const) {
      for (const language of LANGUAGE_CODES) {
        const rendered = templateBody(key, language).replace(
          /\{\{(\d+)\}\}/g,
          (_, n) => longest[Number(n) - 1]
        );
        expect(rendered.length, `${key} / ${language}`).toBeLessThanOrEqual(
          1024
        );
      }
    }
  });
});

describe('buildPortalInviteTemplateParams', () => {
  it('[CTM-002] names the sender and opens on the recorded interests', () => {
    expect(
      buildPortalInviteTemplateParams({
        contactName: 'Pramod Shivanna',
        agentName: 'Lakshmi',
        brandName: 'Aryavarta Ventures',
        scope: 'vacant plot for sale in BTM 2nd Stage',
        audience: 'buyer',
      })
    ).toEqual([
      'Pramod',
      'Lakshmi from Aryavarta Ventures',
      'It already opens on vacant plot for sale in BTM 2nd Stage for you — change the filters any time to widen the search.',
    ]);
  });

  it('[CTM-002] tells a co-broker to clear the filters for the full inventory', () => {
    const [, , scope] = buildPortalInviteTemplateParams({
      contactName: 'Nataraj Kumar',
      agentName: null,
      brandName: 'Aryavarta Ventures',
      scope: 'apartment in Whitefield',
      audience: 'agent',
    });
    expect(scope).toBe(
      'It already opens on apartment in Whitefield — clear the filters to see the full inventory.'
    );
  });

  it('[CTM-002] fills a non-English variant with parameters in its own language', () => {
    const params = buildPortalInviteTemplateParams({
      contactName: 'Pramod Shivanna',
      agentName: 'Lakshmi',
      brandName: 'Aryavarta Ventures',
      scope: 'vacant plot for sale in BTM 2nd Stage',
      audience: 'buyer',
      language: 'hi',
    });
    expect(params[1]).toBe('Aryavarta Ventures से Lakshmi');
    expect(params[2]).toBe(
      'यह आपके लिए पहले से vacant plot for sale in BTM 2nd Stage पर खुलता है — खोज बढ़ाने के लिए फ़िल्टर कभी भी बदलें।'
    );
    expect(params[2]).not.toMatch(/It already opens|filters/);
    expect(
      buildPortalInviteTemplateParams({
        contactName: 'Nataraj',
        agentName: null,
        brandName: null,
        scope: null,
        audience: 'agent',
        language: 'kn',
      })[2]
    ).toBe('ಪ್ರತಿ ಲಿಸ್ಟಿಂಗ್ ಅಲ್ಲಿದೆ — ಪ್ರತಿ ಕ್ಲೈಂಟ್‌ಗಾಗಿ ಫಿಲ್ಟರ್ ಮಾಡಿ.');
  });

  it('carries every phrase in every language with the placeholders English uses', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [key, byLanguage] of Object.entries(
      PORTAL_INVITE_PHRASES_BY_KEY
    )) {
      for (const language of LANGUAGE_CODES) {
        const text = byLanguage[language];
        expect(text, `${key} / ${language}`).toBeTruthy();
        expect(placeholders(text), `${key} / ${language}`).toEqual(
          placeholders(byLanguage.en)
        );
        if (language !== 'en') {
          expect(text, `${key} / ${language}`).not.toBe(byLanguage.en);
        }
      }
    }
    expect(
      portalInvitePhrase('sender_from', 'en', { agent: 'A', brand: 'B' })
    ).toBe('A from B');
  });

  it('never sends an empty parameter', () => {
    const params = buildPortalInviteTemplateParams({
      contactName: 'Housing Lead',
      agentName: null,
      brandName: null,
      scope: null,
      audience: 'buyer',
    });
    expect(params[0]).toBe('there');
    expect(params[1]).not.toBe('');
    expect(params[2]).toBe(
      'Use the filters at the top to narrow it down to exactly what you are looking for.'
    );
    for (const param of params) {
      expect(param).not.toMatch(/\n|\t| {4}/);
    }
  });
});

describe('buildPortalInviteFallbackSelection', () => {
  const inventory = [
    { type: 'Flat/ Apartment' },
    { type: 'Residential House' },
    { type: 'Commercial Office Space' },
    { type: 'Agricultural Land' },
  ];

  it('[CTM-002] replaces the listing dump with category counts and a pointer at the portal button', () => {
    const text = buildPortalInviteFallbackSelection(inventory, null, 'buyer');
    expect(text).toBe(
      'Residential: 2 options • Commercial: 1 option • Farm & land: 1 option. Tap Browse showcase below to filter by location, budget and property type, shortlist the ones you like and send your enquiry from the portal.'
    );
  });

  it("[CTM-002] leads with the contact's interests when the portal opens filtered", () => {
    const text = buildPortalInviteFallbackSelection(
      inventory,
      'vacant plot for sale in BTM 2nd Stage',
      'agent'
    );
    expect(text).toContain(
      'Vacant plot for sale in BTM 2nd Stage and more across 4 listings on our portal.'
    );
    expect(text).toContain('agent view');
    expect(text).toContain('your own share link');
  });

  it('[CTM-002] writes the fallback pointer in the language of the template it fills', () => {
    const hindi = buildPortalInviteFallbackSelection(
      inventory,
      'vacant plot for sale in BTM 2nd Stage',
      'buyer',
      'hi'
    );
    expect(hindi).toContain('कैटलॉग देखें');
    expect(hindi).toContain('हमारे पोर्टल पर 4 लिस्टिंग में');
    expect(hindi).not.toMatch(/Tap |and more across/);
  });

  it('still points at the portal when nothing is published', () => {
    const text = buildPortalInviteFallbackSelection([], null, 'buyer');
    expect(text.startsWith('Every listing we have on our portal.')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(600);
  });
});
