// ============================================================
// Reading a template as Meta returns it (GET /message_templates) into
// the shape message_templates stores. Shared by the sync poll and by
// the submit route's adoption path, so a row that adopts a variant Meta
// already holds carries Meta's words, not the words that were refused.
// ============================================================

import type { TemplateButton, TemplateSampleValues } from '@/types';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export interface MetaButton {
  type: string;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
}

export interface MetaTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: MetaButton[];
  example?: {
    header_text?: string[];
    header_handle?: string[];
    body_text?: string[][];
  };
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: MetaTemplateComponent[];
  quality_score?: { score?: string } | string;
}

export function normalizeQualityScore(
  raw: MetaTemplate['quality_score']
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null;
  if (!score) return null;
  const upper = score.toUpperCase();
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null;
}

export function parseButtons(
  metaButtons: MetaButton[] | undefined
): TemplateButton[] {
  if (!metaButtons?.length) return [];
  const out: TemplateButton[] = [];
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text });
        break;
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        });
        break;
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        });
        break;
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example)
            ? (b.example[0] ?? '')
            : (b.example ?? ''),
        });
        break;
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out;
}

export function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0];
  const headerSample = header?.example?.header_text;
  if (!bodySample?.length && !headerSample?.length) return null;
  const sv: TemplateSampleValues = {};
  if (bodySample?.length) sv.body = bodySample;
  if (headerSample?.length) sv.header = headerSample;
  return sv;
}

export type MetaHeaderType = 'text' | 'image' | 'video' | 'document';

export interface MetaTemplateContent {
  header_type: MetaHeaderType | null;
  header_content: string | null;
  header_handle: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: TemplateButton[] | null;
  sample_values: TemplateSampleValues | null;
}

/** The content columns of a row, as Meta holds them. */
export function metaTemplateContent(t: MetaTemplate): MetaTemplateContent {
  const body = (t.components ?? []).find((c) => c.type === 'BODY');
  const header = (t.components ?? []).find((c) => c.type === 'HEADER');
  const footer = (t.components ?? []).find((c) => c.type === 'FOOTER');
  const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS');

  const parsedButtons = parseButtons(buttons?.buttons);
  const headerFormat = header?.format?.toUpperCase();
  const headerType =
    headerFormat === 'TEXT' ||
    headerFormat === 'IMAGE' ||
    headerFormat === 'VIDEO' ||
    headerFormat === 'DOCUMENT'
      ? (headerFormat.toLowerCase() as MetaHeaderType)
      : null;

  return {
    header_type: headerType,
    header_content: header?.text ?? null,
    header_handle: header?.example?.header_handle?.[0] ?? null,
    body_text: body?.text ?? '',
    footer_text: footer?.text ?? null,
    buttons: parsedButtons.length ? parsedButtons : null,
    sample_values: extractSampleValues(body, header),
  };
}

/**
 * The same content in submit-payload shape (undefined, not null), for
 * a payload that adopts what Meta holds. header_media_url is left as
 * submitted: Meta returns a handle, never the sample's URL.
 */
export function metaTemplatePayloadFields(
  t: MetaTemplate
): Pick<
  TemplatePayload,
  | 'header_type'
  | 'header_content'
  | 'header_handle'
  | 'body_text'
  | 'footer_text'
  | 'buttons'
  | 'sample_values'
> {
  const c = metaTemplateContent(t);
  return {
    header_type: c.header_type ?? undefined,
    header_content: c.header_content ?? undefined,
    header_handle: c.header_handle ?? undefined,
    body_text: c.body_text,
    footer_text: c.footer_text ?? undefined,
    buttons: c.buttons ?? undefined,
    sample_values: c.sample_values ?? undefined,
  };
}
