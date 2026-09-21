import type { LanguageCode } from '@/lib/languages';
import { truncateParametersToBudget } from '@/lib/whatsapp/template-send-builder';
import {
  engineShareTemplateLabel,
  pickPropertyShareTemplate,
  propertyShareParams,
  shareHeaderImage,
  shareUnsentReason,
} from '@/lib/whatsapp/property-share-template';
import type { MessageTemplate, Property } from '@/types';

export interface SharePropertyPreview {
  template: {
    name: string;
    label: string;
    language: string;
    header_type: string | null;
  } | null;
  template_status: string;
  preview: string | null;
  unsent_reason: string | null;
  images: string[];
}

export function renderShareTemplateBody(
  bodyText: string,
  params: string[]
): string {
  return bodyText
    .replace(/\\n/g, '\n')
    .replace(/\{\{(\d+)\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}

export function buildSharePropertyPreview(opts: {
  candidates: MessageTemplate[];
  property: Property;
  contactName: string | null;
  brandName: string | null;
  brandImage: string | null;
  language?: LanguageCode;
}): SharePropertyPreview {
  const { candidates, property, contactName, brandName, brandImage } = opts;
  const images = (property.images ?? []).filter(
    (img) => img && img.trim().length > 0
  );
  const latestTemplate = candidates[0] ?? null;
  const headerImage = shareHeaderImage({ images: property.images, brandImage });
  const picked = pickPropertyShareTemplate(candidates, {
    hasImage: Boolean(headerImage),
    language: opts.language,
  });
  const template = picked?.buttons?.some(
    (button) => button.type === 'URL' && button.url.includes('{{1}}')
  )
    ? picked
    : null;
  const templateStatus = latestTemplate?.status ?? 'NONE';
  if (!template) {
    return {
      template: null,
      template_status: templateStatus,
      preview: null,
      unsent_reason: shareUnsentReason(templateStatus),
      images,
    };
  }
  const params = truncateParametersToBudget(template.body_text, [
    ...propertyShareParams(template.name, contactName, property, brandName),
  ]);
  return {
    template: {
      name: template.name,
      label: engineShareTemplateLabel(template.name),
      language: template.language ?? 'en_US',
      header_type: template.header_type ?? null,
    },
    template_status: template.status ?? 'APPROVED',
    preview: renderShareTemplateBody(template.body_text, params),
    unsent_reason: null,
    images,
  };
}
