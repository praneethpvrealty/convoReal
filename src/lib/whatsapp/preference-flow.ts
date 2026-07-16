/**
 * Buyer Preference Intake — native Meta WhatsApp Flow blueprint.
 *
 * This is a *Meta* Flow (form screens rendered inside WhatsApp), not the
 * in-app chatbot flow builder in src/lib/flows/. The JSON produced here
 * is uploaded to Meta via the Graph API (see meta-flow-service.ts) and
 * served dynamically through the encrypted data-exchange endpoint at
 * /api/whatsapp/flows/endpoint/[accountId]:
 *
 *   INIT           -> we return the PREFERENCES screen prefilled from the
 *                     contact's current preference columns
 *   data_exchange  -> we persist the submitted values to the contact and
 *                     close the flow (SUCCESS + extension_message_response)
 *   nfm_reply      -> webhook-handler confirms to the buyer in chat
 *
 * Everything in this module is pure (no I/O) so it can be unit tested.
 */

export const PREFERENCE_FLOW_KEY = 'preference_intake'
export const PREFERENCE_FLOW_NAME = 'Buyer Preference Intake'
export const PREFERENCE_SCREEN_ID = 'PREFERENCES'
export const SAVE_PREFERENCES_ACTION = 'save_preferences'
/** interactiveReplyId that triggers sending this flow from a button. */
export const PREFERENCE_FLOW_BUTTON_ID = 'update_preferences'

/** Flow JSON schema version uploaded to Meta. */
export const PREFERENCE_FLOW_JSON_VERSION = '7.2'
/** Data channel version for endpoint-backed flows. */
export const PREFERENCE_FLOW_DATA_API_VERSION = '3.0'

/**
 * Same vocabulary as PROPERTY_INTEREST_OPTIONS in
 * src/components/contacts/contact-form.tsx — the `id` is what gets
 * stored in contacts.property_interests, titles are shortened to stay
 * within Meta's 30-char CheckboxGroup item limit.
 */
export const PROPERTY_INTEREST_FLOW_OPTIONS: Array<{ id: string; title: string }> = [
  { id: 'Vacant plot', title: 'Vacant plot' },
  { id: 'Vacant building', title: 'Vacant building' },
  { id: 'Rental building with some ROI', title: 'Rental building with ROI' },
  { id: 'Old building selling at site rate', title: 'Old building at site rate' },
]

// ── Flow JSON ─────────────────────────────────────────────────────

/**
 * Build the complete Flow JSON document for the preference intake form.
 * Field names here MUST stay in sync with parsePreferenceFormValues —
 * they round-trip through `${form.*}` bindings in the Footer payload.
 */
export function buildPreferenceFlowJson(): Record<string, unknown> {
  return {
    version: PREFERENCE_FLOW_JSON_VERSION,
    data_api_version: PREFERENCE_FLOW_DATA_API_VERSION,
    routing_model: { [PREFERENCE_SCREEN_ID]: [] },
    screens: [
      {
        id: PREFERENCE_SCREEN_ID,
        title: 'My Preferences',
        terminal: true,
        data: {
          min_budget: { type: 'string', __example__: '5000000' },
          max_budget: { type: 'string', __example__: '20000000' },
          areas: { type: 'string', __example__: 'JP Nagar, Jayanagar' },
          min_roi: { type: 'string', __example__: '4.5' },
          selected_property_types: {
            type: 'array',
            items: { type: 'string' },
            __example__: ['Vacant plot'],
          },
          property_type_options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
              },
            },
            __example__: PROPERTY_INTEREST_FLOW_OPTIONS,
          },
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'TextBody',
              text: 'Tell us what you are looking for and we will match you with the right properties.',
            },
            {
              type: 'Form',
              name: 'preference_form',
              // Inputs are wrapped in a Form (v4.0+), so per-field
              // "init-value" is invalid here — Meta rejects it at
              // publish time ("Property 'init-value' is not allowed
              // in 'TextInput' component."). Form-wrapped children
              // are prefilled via the Form's own "init-values" map
              // instead; each entry still supports the same
              // ${data.xxx} template binding.
              'init-values': {
                min_budget: '${data.min_budget}',
                max_budget: '${data.max_budget}',
                areas: '${data.areas}',
                property_types: '${data.selected_property_types}',
                min_roi: '${data.min_roi}',
              },
              children: [
                {
                  type: 'TextInput',
                  name: 'min_budget',
                  label: 'Minimum budget (INR)',
                  'input-type': 'number',
                  required: false,
                },
                {
                  type: 'TextInput',
                  name: 'max_budget',
                  label: 'Maximum budget (INR)',
                  'input-type': 'number',
                  required: false,
                },
                {
                  type: 'TextArea',
                  name: 'areas',
                  label: 'Preferred localities',
                  'helper-text': 'Separate multiple localities with commas',
                  required: false,
                },
                {
                  type: 'CheckboxGroup',
                  name: 'property_types',
                  label: 'Property types',
                  'data-source': '${data.property_type_options}',
                  required: false,
                },
                {
                  type: 'TextInput',
                  name: 'min_roi',
                  label: 'Expected min ROI (%)',
                  'input-type': 'number',
                  required: false,
                },
                {
                  type: 'Footer',
                  label: 'Save preferences',
                  'on-click-action': {
                    name: 'data_exchange',
                    payload: {
                      action_type: SAVE_PREFERENCES_ACTION,
                      min_budget: '${form.min_budget}',
                      max_budget: '${form.max_budget}',
                      areas: '${form.areas}',
                      property_types: '${form.property_types}',
                      min_roi: '${form.min_roi}',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  }
}

// ── Prefill (INIT) ────────────────────────────────────────────────

/** The subset of a contacts row this flow reads and writes. */
export interface ContactPreferenceSource {
  min_budget?: number | null
  max_budget?: number | null
  areas_of_interest?: string[] | null
  property_interests?: string[] | null
  min_roi?: number | null
}

/**
 * Screen data returned from the endpoint on INIT. Keys must match the
 * screen's `data` schema in buildPreferenceFlowJson.
 */
export function buildPreferencePrefillData(
  contact: ContactPreferenceSource
): Record<string, unknown> {
  const knownIds = new Set(PROPERTY_INTEREST_FLOW_OPTIONS.map((o) => o.id))
  return {
    min_budget: contact.min_budget != null ? String(contact.min_budget) : '',
    max_budget: contact.max_budget != null ? String(contact.max_budget) : '',
    areas: (contact.areas_of_interest || []).join(', '),
    min_roi: contact.min_roi != null ? String(contact.min_roi) : '',
    selected_property_types: (contact.property_interests || []).filter((p) =>
      knownIds.has(p)
    ),
    property_type_options: PROPERTY_INTEREST_FLOW_OPTIONS,
  }
}

// ── Response parsing (data_exchange / nfm_reply) ──────────────────

export interface PreferenceFormValues {
  min_budget?: string
  max_budget?: string
  areas?: string
  property_types?: string[]
  min_roi?: string
}

/**
 * Extract the form fields from an untrusted payload (either the
 * decrypted data_exchange `data` object or the parsed nfm_reply
 * response_json). Non-string / non-array junk is dropped.
 */
export function parsePreferenceFormValues(
  raw: Record<string, unknown> | null | undefined
): PreferenceFormValues {
  const values: PreferenceFormValues = {}
  if (!raw || typeof raw !== 'object') return values

  const readString = (key: keyof PreferenceFormValues) => {
    const v = raw[key]
    if (typeof v === 'string') values[key] = v as never
  }
  readString('min_budget')
  readString('max_budget')
  readString('areas')
  readString('min_roi')

  const types = raw.property_types
  if (Array.isArray(types)) {
    values.property_types = types.filter((t): t is string => typeof t === 'string')
  }
  return values
}

export interface ContactPreferenceUpdate {
  min_budget?: number | null
  max_budget?: number | null
  areas_of_interest?: string[]
  property_interests?: string[]
  min_roi?: number | null
}

/** Parse a numeric form value; strips commas/currency noise. Returns
 *  null for an intentionally cleared field, undefined for unparseable. */
function parseNumericField(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined
  const cleaned = value.replace(/[,\s₹%]/g, '')
  if (cleaned === '') return null
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num < 0) return undefined
  return num
}

/**
 * Map submitted form values onto a contacts-table update payload.
 * The form is prefilled with the current state, so a present-but-empty
 * field means "clear this preference"; a missing key means "leave as is".
 */
export function preferenceFormToContactUpdate(
  values: PreferenceFormValues
): ContactPreferenceUpdate {
  const update: ContactPreferenceUpdate = {}

  const minBudget = parseNumericField(values.min_budget)
  if (minBudget !== undefined) update.min_budget = minBudget
  const maxBudget = parseNumericField(values.max_budget)
  if (maxBudget !== undefined) update.max_budget = maxBudget
  const minRoi = parseNumericField(values.min_roi)
  if (minRoi !== undefined) update.min_roi = minRoi

  if (values.areas !== undefined) {
    update.areas_of_interest = values.areas
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
  }

  if (values.property_types !== undefined) {
    const knownIds = new Set(PROPERTY_INTEREST_FLOW_OPTIONS.map((o) => o.id))
    update.property_interests = values.property_types.filter((t) => knownIds.has(t))
  }

  return update
}

// ── Chat helpers ──────────────────────────────────────────────────

const formatInr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Human-readable confirmation sent back in the chat after saving. */
export function summarizePreferenceUpdate(update: ContactPreferenceUpdate): string {
  const lines: string[] = []
  if (update.min_budget !== undefined || update.max_budget !== undefined) {
    const min = update.min_budget != null ? formatInr(update.min_budget) : null
    const max = update.max_budget != null ? formatInr(update.max_budget) : null
    if (min && max) lines.push(`• Budget: ${min} – ${max}`)
    else if (min) lines.push(`• Budget: from ${min}`)
    else if (max) lines.push(`• Budget: up to ${max}`)
  }
  if (update.areas_of_interest !== undefined) {
    lines.push(
      update.areas_of_interest.length > 0
        ? `• Localities: ${update.areas_of_interest.join(', ')}`
        : '• Localities: no preference'
    )
  }
  if (update.property_interests !== undefined && update.property_interests.length > 0) {
    lines.push(`• Property types: ${update.property_interests.join(', ')}`)
  }
  if (update.min_roi != null) {
    lines.push(`• Expected min ROI: ${update.min_roi}%`)
  }

  if (lines.length === 0) {
    return '✅ Thanks! Your preferences have been updated.'
  }
  return `✅ Thanks! Your preferences have been updated:\n\n${lines.join('\n')}\n\nWe'll use these to match you with the right properties.`
}

/**
 * Detect a buyer asking to update their preferences in free text.
 * Deliberately narrow — generic "update" phrasing is owned by the
 * property/contact update_sessions feature in webhook-handler.
 */
export function isPreferenceFlowRequestText(text: string | null | undefined): boolean {
  if (!text) return false
  const cleaned = text.trim().toLowerCase()
  if (cleaned.length > 80) return false
  return /\b(update|change|edit|set|modify)\b.{0,24}\bpreferences?\b|\bmy preferences?\b|\bpreference form\b/.test(
    cleaned
  )
}
