// The predefined "audio_announcement_notice" WhatsApp template — the
// closed-window carrier for audio announcements (plan §7, path 2).
// Meta has no audio header format, so the worker packages the voice
// note as an mp4 (still card + narration) and this VIDEO-header
// template delivers it to contacts outside the 24-hour window. The
// video is supplied at send time via headerMediaUrl; the sample below
// is only for Meta's review. Submitted as Marketing honestly — an
// announcement is promotional, and §2.7 forbids resubmitting under new
// names to chase a Utility ruling.

import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import {
  DEFAULT_LANGUAGE,
  metaLanguageCode,
  type LanguageCode,
} from '@/lib/languages';
import { templateBody } from '@/lib/whatsapp/template-copy';
import {
  pickApprovedTemplate,
  type ApprovedTemplateCandidate,
} from '@/lib/whatsapp/pick-approved-template';

export const ANNOUNCEMENT_TEMPLATE_NAME = 'audio_announcement_notice';

export const ANNOUNCEMENT_TEMPLATE_NAMES = [ANNOUNCEMENT_TEMPLATE_NAME];

/** The announcement template a closed-window send should use. */
export function pickAnnouncementTemplate<T extends ApprovedTemplateCandidate>(
  rows: T[]
): T | null {
  return pickApprovedTemplate(rows, ANNOUNCEMENT_TEMPLATE_NAMES);
}

export function buildAnnouncementTemplatePayload(
  origin: string,
  language: LanguageCode = DEFAULT_LANGUAGE
): TemplatePayload {
  const base = origin.replace(/\/+$/, '');
  return {
    name: ANNOUNCEMENT_TEMPLATE_NAME,
    category: 'Marketing',
    language: metaLanguageCode(language),
    header_type: 'video',
    // Review-time sample only — a stable mp4 every deployment serves.
    // Real sends override it with the announcement video (headerMediaUrl).
    header_media_url: `${base}/brand/announcement-sample.mp4`,
    body_text: templateBody('audio_announcement', language),
    sample_values: {
      body: ['Gopi', 'Aryavarta Ventures'],
    },
  };
}

/** Body {{1}} contact name, {{2}} brokerage/brand name. */
export function buildAnnouncementParams(
  contactName: string | null | undefined,
  brandName: string
): string[] {
  return [contactName?.trim() || 'there', brandName];
}
