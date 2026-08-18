import { describe, expect, it } from 'vitest';
import type { Property } from '@/types';
import { buildPublicBusinessProfile } from '@/lib/seo/business-profile';
import { buildLlmsText, buildPublicAgentOpenApi } from './publicInterface';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const property = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  account_id: accountId,
  title: 'Confidential exact road commercial building',
  description: 'Published listing',
  type: 'Commercial Building',
  listing_type: 'Sale',
  status: 'Available',
  is_published: true,
  location: '42 Confidential Exact Road',
  sublocality: 'JP Nagar',
  city: 'Bengaluru',
  location_privacy: 'locality',
  showcase_visibility: 'open',
  price: 50_000_000,
  images: [],
  private_images: [],
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-18T00:00:00.000Z',
} as unknown as Property;

describe('public AI-agent interface', () => {
  it('documents grounded search and consented enquiry actions', () => {
    const document = buildPublicAgentOpenApi({
      origin: 'https://aryavarta.example',
      accountId,
      businessName: 'Aryavarta Realty',
      description: 'Current property information.',
      requiresCatalogApiKey: false,
    });

    const enquiry =
      document.paths['/api/public/inquiry'].post.requestBody.content[
        'application/json'
      ].schema;
    expect(enquiry.required).toContain('consentToContact');
    expect(enquiry.properties.source).toEqual({
      type: 'string',
      const: 'ai_agent',
    });
    expect(enquiry.properties.consentToContact).toEqual({
      type: 'boolean',
      const: true,
    });
    expect(
      document.paths['/api/public/agent/feed'].get.parameters.find(
        (parameter) => parameter.name === 'account_id'
      )?.schema
    ).toMatchObject({ const: accountId });
  });

  it('publishes useful current listings without exposing guarded locations', () => {
    const profile = buildPublicBusinessProfile('Aryavarta Realty', [property]);
    const result = buildLlmsText({
      origin: 'https://aryavarta.example',
      accountId,
      businessName: 'Aryavarta Realty',
      profile,
      properties: [property],
    });

    expect(result).toContain('# Aryavarta Realty');
    expect(result).toContain('/api/public/agent/feed?account_id=');
    expect(result).toContain('Commercial Building in JP Nagar');
    expect(result).not.toContain('42 Confidential Exact Road');
    expect(result).not.toContain('Confidential exact road commercial building');
  });
});
