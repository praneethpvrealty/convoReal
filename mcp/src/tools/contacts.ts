// ============================================================
// Contact tools: search, fetch, "what fits this buyer", notes, and
// the two safe writes (create a contact, append a note).
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ConvoRealClient } from '../client.js';
import { toToolError } from '../errors.js';
import {
  bullets,
  formatDate,
  formatMoney,
  renderPage,
  renderRecord,
  type PageEnvelope,
} from '../format.js';
import { idField, paginationFields, responseFormatField } from '../schemas.js';
import { propertyLine } from './properties.js';
import type {
  PropertyMatch,
  V1Contact,
  V1ContactDetail,
  V1Note,
} from '../types.js';

const CLASSIFICATIONS = [
  'Owner',
  'Seller',
  'Buyer',
  'Agent',
  'Developer',
  'Owner & Buyer',
  'Others',
] as const;

function budgetLine(contact: V1Contact): string | null {
  if (contact.budget.unconstrained) return 'no constraint';
  if (!contact.budget.min && !contact.budget.max) return null;
  return `${formatMoney(contact.budget.min)} – ${formatMoney(contact.budget.max)}`;
}

function contactLine(c: V1Contact): string {
  return [
    `## ${c.name ?? '(unnamed)'}`,
    bullets([
      ['Id', c.id],
      ['Phone', c.phone],
      ['Email', c.email],
      ['Type', c.classification],
      ['Lead', c.lead_temp],
      ['Budget', budgetLine(c)],
      ['Areas', c.areas_of_interest.join(', ')],
      ['Requirement', c.requirement_active ? c.requirements : null],
      ['Last contacted', formatDate(c.last_contacted_at)],
    ]),
  ].join('\n');
}

const SearchInput = z
  .object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Free text matched against name, phone, email and company.'),
    classification: z
      .enum(CLASSIFICATIONS)
      .optional()
      .describe('Filter by contact type.'),
    lead_temp: z
      .enum(['HOT', 'COLD', 'Not Responding', 'Dead'])
      .optional()
      .describe('Filter by lead temperature.'),
    has_requirement: z
      .boolean()
      .optional()
      .describe(
        'Only contacts with an active stated requirement — the population worth matching.'
      ),
    include_archived: z
      .boolean()
      .default(false)
      .describe(
        'Include archived and dead contacts. Off by default; they are excluded from matching and sends.'
      ),
    ...paginationFields,
  })
  .strict();

const GetInput = z
  .object({
    contact_id: idField('contact'),
    response_format: responseFormatField,
  })
  .strict();

const MatchInput = z
  .object({
    contact_id: idField('contact'),
    min_score: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        "Only return matches at or above this score. Defaults to 60, the app's own floor."
      ),
    ...paginationFields,
  })
  .strict();

const NotesInput = z
  .object({ contact_id: idField('contact'), ...paginationFields })
  .strict();

const CreateInput = z
  .object({
    name: z.string().min(1).max(120).describe("Contact's name. Required."),
    phone: z
      .string()
      .max(30)
      .optional()
      .describe(
        'Phone in international format, e.g. 919876543210. Required unless email is given.'
      ),
    email: z
      .string()
      .email()
      .optional()
      .describe('Email. Required unless phone is given.'),
    classification: z
      .enum(CLASSIFICATIONS)
      .default('Buyer')
      .describe('What kind of contact this is.'),
    requirements: z
      .string()
      .max(2000)
      .optional()
      .describe(
        'What they are looking for, in plain language. The app extracts budget, areas and property types from this, so write it as the buyer said it.'
      ),
    response_format: responseFormatField,
  })
  .strict();

const NoteInput = z
  .object({
    contact_id: idField('contact'),
    note: z.string().min(1).max(5000).describe('The note text.'),
    response_format: responseFormatField,
  })
  .strict();

export function registerContactTools(
  server: McpServer,
  client: ConvoRealClient
): void {
  server.registerTool(
    'convoreal_search_contacts',
    {
      title: 'Search contacts',
      description: `Search the workspace's contacts and leads by name, phone, email or company, with filters for contact type, lead temperature and whether they have stated a requirement.

Archived and dead contacts are excluded unless include_archived is true — they are excluded from matching and automated sends too, so including them usually means surfacing rows nothing else will act on.

Returns id, name, phone, classification, lead temperature, budget band, areas of interest and their stated requirement.

Examples:
  - "hot buyers" -> classification: "Buyer", lead_temp: "HOT"
  - "who is looking for something right now" -> has_requirement: true
  - "find Asha's number" -> query: "Asha"`,
      inputSchema: SearchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<V1Contact>>('/contacts', {
          q: params.query,
          classification: params.classification,
          lead_temp: params.lead_temp,
          has_requirement: params.has_requirement,
          include_archived: params.include_archived,
          limit: params.limit,
          offset: params.offset,
        });

        return renderPage({
          title: 'Contacts',
          page: data,
          renderItem: contactLine,
          emptyHint:
            'Try a shorter `query` (a first name or the last few digits of a phone), or drop the classification filter.',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_get_contact',
    {
      title: 'Get one contact',
      description: `Fetch a single contact with their full stated brief: budget, areas of interest, named projects, property types, and whether their area or project preferences are strict.

Takes a contact id (UUID) — get one from convoreal_search_contacts.`,
      inputSchema: GetInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ contact_id, response_format }) => {
      try {
        const { contact } = await client.get<{ contact: V1ContactDetail }>(
          `/contacts/${contact_id}`
        );

        const body = bullets([
          ['Id', contact.id],
          ['Phone', contact.phone],
          ['Email', contact.email],
          ['Company', contact.company],
          ['Type', contact.classification],
          ['Lead', contact.lead_temp],
          ['Budget', budgetLine(contact)],
          ['Areas', contact.areas_of_interest.join(', ')],
          ['Projects', contact.projects_of_interest.join(', ')],
          ['Property interests', contact.property_interests.join(', ')],
          ['Strict on area', contact.strict_area_match ? 'yes' : null],
          ['Strict on project', contact.strict_project_match ? 'yes' : null],
          ['Requirement', contact.requirements],
          [
            'Requirement active',
            contact.requirement_active ? 'yes' : 'no (parked)',
          ],
          ['Last contacted', formatDate(contact.last_contacted_at)],
        ]);

        return renderRecord(
          contact.name ?? '(unnamed contact)',
          body,
          contact as unknown as Record<string, unknown>,
          response_format
        );
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_match_properties_for_contact',
    {
      title: 'Find properties for a buyer',
      description: `Rank the workspace's available inventory against one contact's brief, best fit first.

The transpose of convoreal_match_contacts_for_property, and it runs the same engine, so the two never disagree. Only listings that can actually be transacted are considered (Available and Under Contract); sold, archived and off-market stock is excluded.

Each result carries a score (0-100), per-field verdicts and plain-language reasons.

If the contact has no stated budget, area, project or requirement, this returns nothing and says so — there is no brief to rank against. Add one with convoreal_create_contact's requirements field or in the app first.

Use this to answer "what should I show this buyer?".`,
      inputSchema: MatchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<
          PageEnvelope<PropertyMatch> & { contact_id: string }
        >(`/contacts/${params.contact_id}/matches`, {
          min_score: params.min_score,
          limit: params.limit,
          offset: params.offset,
        });

        return renderPage({
          title: 'Matching properties',
          page: data,
          renderItem: (m) =>
            [
              `${propertyLine(m.property)}`,
              `- **Score**: ${m.score}${m.reasons.length ? ` — ${m.reasons.join(' · ')}` : ''}`,
            ].join('\n'),
          emptyHint:
            "Nothing in inventory fits this brief. Lower min_score, or widen the contact's stated areas and budget.",
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_list_contact_notes',
    {
      title: "Read a contact's notes",
      description: `List the notes recorded against one contact, newest first.

Notes are the free-form history an agent keeps: what was discussed, what the buyer said, what to do next. Read them before answering questions about a contact's situation — the structured fields do not capture the story.`,
      inputSchema: NotesInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<V1Note>>(
          `/contacts/${params.contact_id}/notes`,
          { limit: params.limit, offset: params.offset }
        );

        return renderPage({
          title: 'Contact notes',
          page: data,
          renderItem: (n) => `## ${formatDate(n.created_at)}\n\n${n.note_text}`,
          emptyHint: 'This contact has no notes yet.',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_create_contact',
    {
      title: 'Create a contact',
      description: `Add a new contact to the workspace.

Requires the 'write' scope on the API key.

At least one of phone or email is required. If a contact with the same phone already exists, this fails with a conflict and returns the existing contact's id rather than creating a duplicate — look it up with convoreal_get_contact instead.

Put what the person is looking for in \`requirements\`, in their own words. ConvoReal extracts budget, localities and property types from that text, so a natural sentence produces better matching than a terse label.

This creates a record only. It sends no WhatsApp message and triggers no outreach.`,
      inputSchema: CreateInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ response_format, ...body }) => {
      try {
        const { contact } = await client.post<{ contact: V1Contact }>(
          '/contacts',
          body
        );
        return renderRecord(
          `Created ${contact.name ?? 'contact'}`,
          contactLine(contact),
          contact as unknown as Record<string, unknown>,
          response_format
        );
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_add_contact_note',
    {
      title: 'Add a note to a contact',
      description: `Append a note to a contact's history.

Requires the 'write' scope on the API key.

Use this to record what was learned in a conversation so it reaches the agent working the lead. Notes are visible in the app and feed the matching engine's text heuristics when a contact has no structured preferences.

Notes are append-only; there is no edit or delete through this API.`,
      inputSchema: NoteInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ contact_id, note, response_format }) => {
      try {
        const created = await client.post<{ note: V1Note }>(
          `/contacts/${contact_id}/notes`,
          {
            note,
          }
        );
        return renderRecord(
          'Note added',
          created.note.note_text,
          created.note as unknown as Record<string, unknown>,
          response_format
        );
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
