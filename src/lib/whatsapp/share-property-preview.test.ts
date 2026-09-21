import { describe, expect, it } from 'vitest';
import {
  buildSharePropertyPreview,
  renderShareTemplateBody,
} from './share-property-preview';
import type { MessageTemplate, Property } from '@/types';

const property = {
  id: 'prop-1',
  title: 'Commercial BDA Property in HSR Layout',
  price: 250000000,
  listing_type: 'Sale',
  sublocality: 'HSR Layout Sector 2',
  city: 'Bangalore',
  type: 'Commercial Office',
  google_map_link: 'https://maps.app.goo.gl/example',
  images: ['', 'property-images/acc-1/front.jpg', ' '],
} as unknown as Property;

const photoTemplate = {
  id: 'tpl-photo',
  name: 'listing_photos_notice',
  status: 'APPROVED',
  category: 'Utility',
  language: 'en_US',
  header_type: 'image',
  body_text: 'Hi {{1}}, {{2}} shares {{3}}\\n{{4}}\\n{{5}}',
  buttons: [{ type: 'URL', text: 'View', url: 'https://example.com/{{1}}' }],
} as unknown as MessageTemplate;

const textTemplate = {
  id: 'tpl-text',
  name: 'new_property_alert',
  status: 'APPROVED',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Hi {{1}}! {{2}} — {{3}} at {{4}}.',
  buttons: [{ type: 'URL', text: 'View', url: 'https://example.com/{{1}}' }],
} as unknown as MessageTemplate;

describe('renderShareTemplateBody', () => {
  it('fills numbered placeholders and unescapes newlines', () => {
    expect(renderShareTemplateBody('A {{1}}\\nB {{2}} {{3}}', ['x', 'y'])).toBe(
      'A x\nB y {{3}}'
    );
  });
});

describe('buildSharePropertyPreview', () => {
  it('[PRP-012] renders the same template and params the send path would use', () => {
    const preview = buildSharePropertyPreview({
      candidates: [textTemplate, photoTemplate],
      property,
      contactName: 'Rajath Kumar',
      brandName: 'Acme Realty',
      brandImage: null,
    });
    expect(preview.template).toMatchObject({
      name: 'listing_photos_notice',
      label: 'Listing details with photo',
      header_type: 'image',
    });
    expect(preview.preview).toContain('Hi Rajath, Acme Realty shares Commercial BDA Property in HSR Layout');
    expect(preview.preview).toContain('HSR Layout Sector 2, Bangalore');
    expect(preview.unsent_reason).toBeNull();
    expect(preview.images).toEqual(['property-images/acc-1/front.jpg']);
  });

  it('greets a nameless recipient generically', () => {
    const preview = buildSharePropertyPreview({
      candidates: [textTemplate],
      property: { ...property, images: [] } as Property,
      contactName: null,
      brandName: null,
      brandImage: null,
    });
    expect(preview.template?.label).toBe('Listing details');
    expect(preview.preview?.startsWith('Hi there!')).toBe(true);
  });

  it('[PRP-012] explains an unsendable share before anything is sent', () => {
    const none = buildSharePropertyPreview({
      candidates: [],
      property,
      contactName: 'Rajath',
      brandName: null,
      brandImage: null,
    });
    expect(none.template).toBeNull();
    expect(none.template_status).toBe('NONE');
    expect(none.unsent_reason).toContain('no listing template has been submitted');

    const pending = buildSharePropertyPreview({
      candidates: [{ ...textTemplate, status: 'PENDING' } as MessageTemplate],
      property,
      contactName: 'Rajath',
      brandName: null,
      brandImage: null,
    });
    expect(pending.template).toBeNull();
    expect(pending.template_status).toBe('PENDING');
    expect(pending.unsent_reason).toContain('awaiting Meta approval');
  });
});
