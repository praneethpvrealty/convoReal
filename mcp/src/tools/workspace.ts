// ============================================================
// Workspace-level tools: the Match Radar feed, the deal pipeline,
// the agenda, and creating a to-do.
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
  ResponseFormat,
  type PageEnvelope,
} from '../format.js';
import { idField, paginationFields, responseFormatField } from '../schemas.js';
import type { V1Agenda, V1Deal, V1RadarEvent, V1Todo } from '../types.js';

const RadarInput = z
  .object({
    status: z
      .enum(['new', 'sent', 'dismissed'])
      .default('new')
      .describe(
        "Which events to return. 'new' (default) is the unresolved feed."
      ),
    kind: z
      .enum(['new_property', 'buyer_updated'])
      .optional()
      .describe(
        "'new_property': a listing landed and these contacts fit it. 'buyer_updated': a buyer's brief changed and these listings fit them."
      ),
    ...paginationFields,
  })
  .strict();

const DealsInput = z
  .object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Free text matched against the deal title.'),
    status: z
      .enum(['open', 'won', 'lost'])
      .optional()
      .describe('Filter by deal outcome.'),
    pipeline_id: z
      .string()
      .uuid()
      .optional()
      .describe('Restrict to one pipeline.'),
    stage_id: z.string().uuid().optional().describe('Restrict to one stage.'),
    contact_id: z
      .string()
      .uuid()
      .optional()
      .describe("Restrict to one contact's deals."),
    min_value: z
      .number()
      .min(0)
      .optional()
      .describe('Minimum deal value in rupees.'),
    ...paginationFields,
  })
  .strict();

const AgendaInput = z
  .object({
    from: z
      .string()
      .optional()
      .describe(
        'Start of the window, YYYY-MM-DD or ISO timestamp. Defaults to now.'
      ),
    to: z
      .string()
      .optional()
      .describe(
        'End of the window, YYYY-MM-DD or ISO timestamp. Defaults to 7 days after `from`.'
      ),
    response_format: responseFormatField,
  })
  .strict();

const TodoInput = z
  .object({
    title: z.string().min(1).max(200).describe('What needs doing.'),
    description: z
      .string()
      .max(2000)
      .optional()
      .describe('Any detail worth keeping.'),
    due_date: z
      .string()
      .optional()
      .describe(
        'When it is due, YYYY-MM-DD or ISO timestamp. Omit for no due date.'
      ),
    priority: z
      .enum(['low', 'medium', 'high'])
      .default('medium')
      .describe('Task priority.'),
    contact_id: idField('contact')
      .optional()
      .describe('Link the task to a contact.'),
    property_id: idField('property')
      .optional()
      .describe('Link the task to a property.'),
    response_format: responseFormatField,
  })
  .strict();

export function registerWorkspaceTools(
  server: McpServer,
  client: ConvoRealClient
): void {
  server.registerTool(
    'convoreal_list_radar_events',
    {
      title: 'List Match Radar events',
      description: `List Match Radar events — ConvoReal's proactive feed of "this listing and these buyers fit each other, and nobody has acted on it yet".

Each event has a subject (a new listing, or a buyer whose brief changed) and a snapshot of the ranked counterparties computed when the event fired.

These snapshots are NOT recomputed on read, so they can lag reality. Use this to find what deserves attention, then convoreal_match_contacts_for_property or convoreal_match_properties_for_contact for a fresh ranking before acting.

Defaults to unresolved ('new') events, which is the useful case.`,
      inputSchema: RadarInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<V1RadarEvent>>('/radar', {
          status: params.status,
          kind: params.kind,
          limit: params.limit,
          offset: params.offset,
        });

        return renderPage({
          title: 'Match Radar',
          page: data,
          renderItem: (e) => {
            const subject = e.subject as Record<string, unknown>;
            const label =
              (subject.title as string | undefined) ??
              (subject.name as string | undefined) ??
              '(unknown subject)';
            const top = e.matches
              .slice(0, 5)
              .map(
                (m) =>
                  `${m.name ?? m.id ?? '?'}${m.score ? ` (${m.score})` : ''}`
              )
              .join(', ');

            return [
              `## ${label}`,
              bullets([
                ['Event id', e.id],
                [
                  'Kind',
                  e.kind === 'new_property'
                    ? 'new listing → buyers'
                    : 'buyer updated → listings',
                ],
                ['Subject id', subject.id],
                ['Raised', formatDate(e.created_at)],
                ['Matches', e.matches.length],
                ['Top', top || null],
              ]),
            ].join('\n');
          },
          emptyHint:
            "No unresolved radar events. Try status: 'sent' to see what has already been acted on.",
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_list_deals',
    {
      title: 'List pipeline deals',
      description: `List deals from the sales pipelines, with their stage, pipeline, linked contact and linked property.

Values are in rupees. Filter by status, pipeline, stage, contact or minimum value.

Examples:
  - "what's in the pipeline" -> status: "open"
  - "biggest open deals" -> status: "open", min_value: 10000000
  - "deals with this buyer" -> contact_id: "<uuid>"`,
      inputSchema: DealsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<V1Deal>>('/deals', {
          q: params.query,
          status: params.status,
          pipeline_id: params.pipeline_id,
          stage_id: params.stage_id,
          contact_id: params.contact_id,
          min_value: params.min_value,
          limit: params.limit,
          offset: params.offset,
        });

        return renderPage({
          title: 'Deals',
          page: data,
          renderItem: (d) =>
            [
              `## ${d.title} — ${formatMoney(d.value, d.currency)}`,
              bullets([
                ['Id', d.id],
                ['Stage', d.stage?.name],
                ['Pipeline', d.pipeline?.name],
                ['Status', d.status],
                ['Contact', d.contact?.name],
                ['Property', d.property?.title],
                ['Expected close', formatDate(d.expected_close_date)],
              ]),
            ].join('\n'),
          emptyHint:
            'No deals match. Drop the status filter, or check the pipeline id.',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_get_agenda',
    {
      title: 'Get the agenda',
      description: `Get appointments and open to-dos for a date window — one call, because "what's on this week" is one question.

Defaults to now through seven days out; the window is capped at 90 days. Cancelled appointments are excluded. Overdue to-dos are always included regardless of the window start, since an outstanding task from last week is still outstanding.

Examples:
  - "what's on today" -> no arguments
  - "what's on next month" -> from: "2026-09-01", to: "2026-09-30"`,
      inputSchema: AgendaInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ from, to, response_format }) => {
      try {
        const agenda = await client.get<V1Agenda>('/agenda', { from, to });

        if (response_format === ResponseFormat.JSON) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(agenda, null, 2) },
            ],
            structuredContent: agenda as unknown as Record<string, unknown>,
          };
        }

        const lines = [
          `# Agenda: ${formatDate(agenda.from)} → ${formatDate(agenda.to)}`,
          '',
        ];
        if (agenda.note) lines.push(`> ${agenda.note}`, '');

        lines.push(`## Appointments (${agenda.appointments.length})`, '');
        if (agenda.appointments.length === 0) {
          lines.push('_Nothing scheduled._', '');
        } else {
          for (const a of agenda.appointments) {
            lines.push(
              `### ${a.title} — ${new Date(a.start_time).toISOString().replace('T', ' ').slice(0, 16)}`
            );
            lines.push(
              bullets([
                ['Id', a.id],
                ['Where', a.location],
                ['With', a.contact?.name],
                ['Property', a.property?.title],
                ['Status', a.status],
              ])
            );
            lines.push('');
          }
        }

        lines.push(`## Open to-dos (${agenda.todos.length})`, '');
        if (agenda.todos.length === 0) {
          lines.push('_Nothing outstanding._');
        } else {
          for (const t of agenda.todos) {
            lines.push(
              `- **${t.title}** (${t.priority}) — due ${formatDate(t.due_date)}${
                t.contact?.name ? ` · ${t.contact.name}` : ''
              } · \`${t.id}\``
            );
          }
        }

        if (agenda.truncated.appointments || agenda.truncated.todos) {
          lines.push(
            '',
            '_Some items were omitted — narrow the window to see them all._'
          );
        }

        return {
          content: [
            { type: 'text' as const, text: lines.join('\n').trimEnd() },
          ],
          structuredContent: agenda as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_create_todo',
    {
      title: 'Create a to-do',
      description: `Create a task in the workspace, optionally linked to a contact or a property.

Requires the 'write' scope on the API key.

Use this to leave follow-up work where the agent will actually see it, rather than only in a chat transcript. The task appears on the app's Today and Calendar screens.

Linked ids must belong to this workspace; an id from elsewhere fails with a not-found error rather than creating an unlinked task.`,
      inputSchema: TodoInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ response_format, ...body }) => {
      try {
        const { todo } = await client.post<{ todo: V1Todo }>('/todos', body);
        return renderRecord(
          'To-do created',
          bullets([
            ['Id', todo.id],
            ['Title', todo.title],
            ['Priority', todo.priority],
            ['Due', formatDate(todo.due_date)],
          ]),
          todo as unknown as Record<string, unknown>,
          response_format
        );
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
