/**
 * Build the Meta `components` array used by POST /{phone_number_id}/messages
 * when sending an APPROVED template.
 *
 * Distinct from `template-components.ts` — that module builds the
 * `components` for TEMPLATE CREATION (where you describe headers,
 * footers, buttons, examples). This module builds the per-send
 * `components` (where you fill in variable values and supply the
 * actual media link or button URL suffix for THIS specific delivery).
 *
 * Auto-fills as much as possible from the template row so callers
 * only need to supply values for the variable-bearing fields:
 *
 *   - Static IMAGE/VIDEO/DOCUMENT headers ride along automatically
 *     using the template's `header_media_url` (or `header_handle`).
 *     Meta requires the media component on every send even though
 *     the URL hasn't changed since approval.
 *   - TEXT headers with `{{1}}` need `headerText` from the caller.
 *   - Body variables come in as `body: string[]`, indexed by {{N}}.
 *   - URL buttons with `{{1}}` need `buttonUrlParams[i]` keyed by
 *     button index. URL buttons without variables, plus QUICK_REPLY
 *     and PHONE_NUMBER buttons, don't need send-time parameters.
 *   - COPY_CODE buttons need the actual code to display. We fall
 *     back to the template's `example` value if the caller doesn't
 *     override — that matches the most common use case (a static
 *     promo code) without forcing UI work.
 *
 * Validation throws here (not at the Meta API boundary) so a missing
 * sample surfaces as "Header text variable {{1}} requires a value",
 * not a 400 from Meta that doesn't say which field broke.
 */

import type { MessageTemplate, TemplateButton } from '@/types';
import { storagePublicUrl } from '@/lib/storage/url';
import { extractVariableIndices } from './template-validators';

export interface SendTimeParams {
  /** Values for body {{1}}, {{2}}, … indexed by variable position. */
  body?: string[];
  /** Value for TEXT-header {{1}}, when the header has a variable. */
  headerText?: string;
  /** Override the template's static media URL for this send. */
  headerMediaUrl?: string;
  /** Alternative: send the media by Meta media id (from prior upload). */
  headerMediaId?: string;
  /**
   * Per-button overrides keyed by the button's index in the
   * template's `buttons` array. Used for URL buttons with a {{1}}
   * suffix and for COPY_CODE buttons whose example you want to
   * override at send time.
   */
  buttonParams?: Record<number, string>;
}

export type MetaSendComponent =
  | { type: 'header'; parameters: MetaSendParameter[] }
  | { type: 'body'; parameters: MetaSendParameter[] }
  | {
      type: 'button';
      sub_type: 'url' | 'quick_reply' | 'copy_code';
      index: string;
      parameters: MetaSendParameter[];
    };

type MetaSendParameter =
  | { type: 'text'; text: string }
  | { type: 'image'; image: { link?: string; id?: string } }
  | { type: 'video'; video: { link?: string; id?: string } }
  | { type: 'document'; document: { link?: string; id?: string } }
  | { type: 'coupon_code'; coupon_code: string }
  | { type: 'payload'; payload: string };

/**
 * Sanitizes template parameter values for Meta API compliance.
 * Strips/replaces newlines, carriage returns, tabs with spaces,
 * and collapses multiple spaces to avoid Meta Graph API error #132018.
 */
export function sanitizeParamText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Truncates template parameter values to ensure the final resolved body text
 * (static text + dynamic parameters) does not exceed Meta's 1024-character limit.
 * It iteratively reduces the length of the longest parameter using ellipsis ('...')
 * until the total length is within budget.
 */
export function truncateParametersToBudget(
  templateBodyText: string,
  params: string[],
  maxTotalLength: number = 1024
): string[] {
  const staticText = (templateBodyText || '').replace(/\{\{(\d+)\}\}/g, '');
  const staticLength = staticText.length;
  
  const variableBudget = Math.max(0, maxTotalLength - staticLength);
  
  const currentParams = params.map(p => sanitizeParamText(p));
  let totalLength = currentParams.reduce((sum, p) => sum + p.length, 0);
  
  if (totalLength <= variableBudget) {
    return currentParams;
  }
  
  while (totalLength > variableBudget) {
    let longestIdx = 0;
    let maxLength = -1;
    for (let i = 0; i < currentParams.length; i++) {
      if (currentParams[i].length > maxLength) {
        maxLength = currentParams[i].length;
        longestIdx = i;
      }
    }
    
    if (maxLength <= 0) {
      break;
    }
    
    const excess = totalLength - variableBudget;
    const targetLength = Math.max(0, currentParams[longestIdx].length - excess);
    
    const originalLength = currentParams[longestIdx].length;
    let truncatedValue = '';
    if (targetLength >= 3 && originalLength > targetLength) {
      truncatedValue = currentParams[longestIdx].slice(0, targetLength - 3) + '...';
    } else {
      truncatedValue = currentParams[longestIdx].slice(0, targetLength);
    }
    totalLength -= (originalLength - truncatedValue.length);
    currentParams[longestIdx] = truncatedValue;
  }
  
  return currentParams;
}

function buildHeaderComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const headerType = template.header_type;
  if (!headerType) return null;

  if (headerType === 'text') {
    // TEXT header with {{1}} → need a value. Static text headers
    // (no variables) just ride along inside the template itself; no
    // header component required on send.
    const varCount = extractVariableIndices(template.header_content ?? '').length;
    if (varCount === 0) return null;
    const value = params.headerText;
    if (!value || !value.trim()) {
      throw new Error(
        'Header text variable {{1}} requires a value — pass headerText.',
      );
    }

    // Header variable limit: total header text length <= 60 characters
    const staticHeader = (template.header_content ?? '').replace(/\{\{(\d+)\}\}/g, '');
    const staticHeaderLength = staticHeader.length;
    const headerBudget = Math.max(0, 60 - staticHeaderLength);
    
    let sanitizedVal = sanitizeParamText(value);
    if (sanitizedVal.length > headerBudget) {
      if (headerBudget >= 3) {
        sanitizedVal = sanitizedVal.slice(0, headerBudget - 3) + '...';
      } else {
        sanitizedVal = sanitizedVal.slice(0, headerBudget);
      }
    }

    return {
      type: 'header',
      parameters: [{ type: 'text', text: sanitizedVal }],
    };
  }

  // image / video / document — Meta requires the media component on
  // every send. Prefer the caller's explicit override; fall back to
  // the template's stored sample.
  let link = params.headerMediaUrl ?? template.header_media_url;
  let id = params.headerMediaId ?? template.header_handle;

  // If the id is structurally a URL, treat it as the media link instead of an id
  if (id && (id.startsWith('http://') || id.startsWith('https://'))) {
    if (!link) {
      link = id;
    }
    id = undefined;
  }

  if (!link && !id) {
    throw new Error(
      `${headerType} header requires a media link or id at send time — set header_media_url on the template or pass headerMediaUrl/headerMediaId.`,
    );
  }
  const mediaPayload: { link?: string; id?: string } = id ? { id } : { link: storagePublicUrl(link!) };
  return {
    type: 'header',
    parameters: [
      headerType === 'image'
        ? { type: 'image', image: mediaPayload }
        : headerType === 'video'
          ? { type: 'video', video: mediaPayload }
          : { type: 'document', document: mediaPayload },
    ],
  };
}

function buildBodyComponent(
  template: MessageTemplate,
  params: SendTimeParams,
): MetaSendComponent | null {
  const varCount = extractVariableIndices(template.body_text).length;
  const body = params.body ?? [];
  if (varCount === 0 && body.length === 0) return null;
  if (body.length < varCount) {
    throw new Error(
      `Body has ${varCount} variable(s) but only ${body.length} value(s) were supplied.`,
    );
  }
  // Trim to the variable count — extra values are dropped silently so
  // a legacy caller that passes too many doesn't error out.
  const values = body.slice(0, varCount);
  const truncatedValues = truncateParametersToBudget(template.body_text, values);
  return {
    type: 'body',
    parameters: truncatedValues.map((text) => ({ type: 'text', text: sanitizeParamText(text) })),
  };
}

function buttonNeedsSendParam(
  button: TemplateButton,
  override: string | undefined,
): boolean {
  switch (button.type) {
    case 'URL':
      return extractVariableIndices(button.url).length > 0;
    case 'COPY_CODE':
      // We always emit a button param for COPY_CODE so the customer
      // gets a real code (either the caller's override or the
      // template's example as a default).
      return true;
    case 'QUICK_REPLY':
    case 'PHONE_NUMBER':
      return override !== undefined;
  }
}

function buildButtonComponent(
  button: TemplateButton,
  index: number,
  override: string | undefined,
): MetaSendComponent | null {
  if (!buttonNeedsSendParam(button, override)) return null;

  switch (button.type) {
    case 'URL': {
      // Each URL button is its own component with sub_type=url and
      // the button's index in the template's buttons array.
      if (!override || !override.trim()) {
        throw new Error(
          `URL button #${index + 1} uses {{1}} — requires a buttonParams[${index}] value.`,
        );
      }
      return {
        type: 'button',
        sub_type: 'url',
        index: String(index),
        parameters: [{ type: 'text', text: sanitizeParamText(override) }],
      };
    }
    case 'COPY_CODE': {
      const code = override?.trim() || button.example;
      return {
        type: 'button',
        sub_type: 'copy_code',
        index: String(index),
        parameters: [{ type: 'coupon_code', coupon_code: code }],
      };
    }
    case 'QUICK_REPLY': {
      // Only included when the caller explicitly overrides the
      // payload (rare — usually QR buttons use their default text).
      return {
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: override! }],
      };
    }
    case 'PHONE_NUMBER':
      // PHONE_NUMBER buttons never accept send-time params per Meta —
      // return null even if an override snuck through.
      return null;
  }
}

/**
 * Build the full `components` array for the send-message payload.
 * Returns an empty array when the template is fully static (no
 * variables, no media header), which is a valid Meta request.
 */
export function buildSendComponents(
  template: MessageTemplate,
  params: SendTimeParams = {},
): MetaSendComponent[] {
  const out: MetaSendComponent[] = [];
  const header = buildHeaderComponent(template, params);
  if (header) out.push(header);
  const body = buildBodyComponent(template, params);
  if (body) out.push(body);
  if (template.buttons?.length) {
    template.buttons.forEach((btn, i) => {
      const override = params.buttonParams?.[i];
      const component = buildButtonComponent(btn, i, override);
      if (component) out.push(component);
    });
  }
  return out;
}
