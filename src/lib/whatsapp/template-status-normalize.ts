import type { MessageTemplateStatus } from '@/types'

const ALLOWED: ReadonlyArray<MessageTemplateStatus> = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'IN_APPEAL',
  'PENDING_DELETION',
]

/**
 * Normalize an upstream status string (from the sync poll, submit
 * response, or webhook) into our `MessageTemplateStatus` enum.
 *
 * Meta sometimes returns `PENDING_REVIEW` where the docs say `PENDING`;
 * map it through. Anything we don't recognise falls back to `PENDING`
 * so the row is still visible to the user instead of silently dropped.
 */
export function normalizeStatus(raw: string): MessageTemplateStatus {
  const upper = (raw ?? '').toUpperCase()
  if (upper === 'PENDING_REVIEW') return 'PENDING'
  return (ALLOWED as readonly string[]).includes(upper)
    ? (upper as MessageTemplateStatus)
    : 'PENDING'
}

/**
 * The local complaint fields, as a sync should leave them.
 *
 * Meta is the authority on a row it returns, so its answer retires what
 * we recorded locally. `submission_error` is the record of a handoff
 * that failed — Meta returning the template at all means one of them
 * succeeded — and a refused EDIT wrote that string onto an APPROVED
 * template where nothing could clear it, so a template sending
 * perfectly well wore a red banner indefinitely.
 *
 * `rejection_reason` is Meta's own verdict and survives exactly as long
 * as Meta still calls the template rejected.
 */
export function clearedTemplateComplaints(status: MessageTemplateStatus): {
  submission_error: null
  rejection_reason?: null
} {
  return status === 'REJECTED'
    ? { submission_error: null }
    : { submission_error: null, rejection_reason: null }
}

/**
 * Normalize Meta's UPPERCASE category (create response, sync poll, or
 * template_category_update webhook) into the local casing. Meta decides
 * the effective category — since April 2025 a Utility submission that
 * fails its utility test is approved as MARKETING rather than rejected,
 * so the value Meta returns must always win over the value requested.
 */
export function normalizeCategory(
  raw: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = (raw ?? '').toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}
