import { describe, it, expect } from 'vitest';
import {
  buildPropertyEnquiryPhotosTemplatePayload,
  PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME,
  pickPropertyPhotosTemplate,
} from './property-enquiry-photos-template';
import { buildPropertyAlertTemplatePayload } from './property-alert-template';
import { validateTemplatePayload } from './template-validators';

describe('buildPropertyEnquiryPhotosTemplatePayload', () => {
  it('passes the same validator the submit API runs', () => {
    const payload = buildPropertyEnquiryPhotosTemplatePayload('https://www.convoreal.com');
    expect(() => validateTemplatePayload(payload)).not.toThrow();
    expect(payload.name).toBe(PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME);
  });

  it('is Utility, because Marketing is what Meta frequency-caps', () => {
    const payload = buildPropertyEnquiryPhotosTemplatePayload('https://www.convoreal.com');
    expect(payload.category).toBe('Utility');
  });

  it('carries an image header with a review-time sample URL', () => {
    const payload = buildPropertyEnquiryPhotosTemplatePayload('https://www.convoreal.com/');
    expect(payload.header_type).toBe('image');
    expect(payload.header_media_url).toBe('https://www.convoreal.com/brand/app-icon-1024.png');
  });

  it('carries no sales CTA anywhere — same classifier rules as property_enquiry_response', () => {
    const payload = buildPropertyEnquiryPhotosTemplatePayload('https://www.convoreal.com');
    const everything = [
      payload.body_text,
      ...(payload.buttons ?? []).map((b) => b.text),
      ...(payload.sample_values?.body ?? []),
    ].join('\n');
    expect(everything).not.toMatch(/site visit|book|offer|discount|exclusive|premium|don'?t miss/i);
    expect(payload.body_text).not.toMatch(/[*_]|🏠|📍/);
    expect(payload.body_text).toMatch(/enquiry/i);
  });

  it('uses the same {{1}}..{{4}} body params as property_enquiry_response', () => {
    // Both enquiry templates share buildPropertyAlertParams — a param
    // reorder in one without the other scrambles live sends.
    const photos = buildPropertyEnquiryPhotosTemplatePayload('https://www.convoreal.com');
    const details = buildPropertyAlertTemplatePayload('https://www.convoreal.com');
    expect(photos.sample_values?.body).toEqual(details.sample_values?.body);
    const vars = (s: string) => [...s.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]).sort();
    expect(vars(photos.body_text)).toEqual(vars(details.body_text));
  });

  it('orders the quick reply before the dynamic URL button', () => {
    const payload = buildPropertyEnquiryPhotosTemplatePayload('https://www.convoreal.com/');
    const types = (payload.buttons ?? []).map((b) => b.type);
    expect(types).toEqual(['QUICK_REPLY', 'URL']);
    const urlBtn = payload.buttons?.find((b) => b.type === 'URL');
    expect(urlBtn && 'url' in urlBtn ? urlBtn.url : '').toBe('https://www.convoreal.com/{{1}}');
  });
});

describe('pickPropertyPhotosTemplate', () => {
  const row = (name: string, category = 'Utility', status = 'APPROVED') => ({
    name,
    status,
    category,
  });

  it('prefers the branded name once Meta approves it as Utility', () => {
    expect(
      pickPropertyPhotosTemplate([
        row('property_enquiry_photos'),
        row(PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME),
      ])?.name
    ).toBe(PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME);
  });

  it('keeps the working legacy row while the rename is under review', () => {
    expect(
      pickPropertyPhotosTemplate([
        row('property_enquiry_photos'),
        row(PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME, 'Utility', 'PENDING'),
      ])?.name
    ).toBe('property_enquiry_photos');
  });

  it('keeps the Utility legacy over a rename Meta made Marketing', () => {
    expect(
      pickPropertyPhotosTemplate([
        row('property_enquiry_photos', 'Utility'),
        row(PROPERTY_ENQUIRY_PHOTOS_TEMPLATE_NAME, 'Marketing'),
      ])?.name
    ).toBe('property_enquiry_photos');
  });

  it('is null when the account has neither', () => {
    expect(pickPropertyPhotosTemplate([])).toBeNull();
  });
});
