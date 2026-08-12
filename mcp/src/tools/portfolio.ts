// ============================================================
// Portfolio tools — the owner and buyer portals, seen from the
// agency's side.
//
// These answer questions the per-record tools cannot: how much of the
// owners' stock is still sellable, what the buyer book's budget looks
// like, who is worth calling first. The aggregates are computed in SQL
// (migration 257), not assembled here.
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
import { paginationFields, responseFormatField } from '../schemas.js';
import type {
  BuyerPortfolioRow,
  OwnerPortfolioRow,
  PortfolioSummary,
} from '../types.js';

const SummaryInput = z
  .object({ response_format: responseFormatField })
  .strict();

const ListInput = z.object({ ...paginationFields }).strict();

/** Percentage of a whole, or null when the whole is zero — a "0%" that
 *  really means "nothing to divide" reads as a finding it is not. */
function share(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return `${Math.round((part / whole) * 100)}%`;
}

export function registerPortfolioTools(
  server: McpServer,
  client: ConvoRealClient
): void {
  server.registerTool(
    'convoreal_get_portfolio_summary',
    {
      title: 'Summarise the owner and buyer portals',
      description: `Aggregate view of the workspace's Portfolio portals — the owner-facing side and the buyer-facing side — in one call.

Owner side: how many contacts have an owner login, how much stock they hold, the split across available / under contract / sold / published, the total and average asking price of what is still available, and open bid activity.

Buyer side: how many contacts have a buyer login, how many have stated a budget, the average / median / lowest / highest of their maximum budgets, and shortlist activity.

All money is in RUPEES.

Two distinctions matter when reading the buyer numbers:
  - "unconstrained" buyers have explicitly said they have no budget ceiling. They are counted separately, NOT averaged in as zero.
  - a null average means no buyer has stated a budget at all, which is different from an average of zero.

Only portal users linked to THIS workspace are counted. Someone registered with two agencies contributes to each one's numbers separately.

Use this for "how is my book doing" questions. Use convoreal_list_portfolio_owners or convoreal_list_portfolio_buyers to see who sits behind the numbers.`,
      inputSchema: SummaryInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ response_format }) => {
      try {
        const summary = await client.get<PortfolioSummary>('/portfolio/summary');
        const { owners, buyers } = summary;

        const body = [
          '## Owners',
          '',
          bullets([
            ['With a portal login', owners.linked_owners],
            ['Holding listings', owners.owners_with_listings],
            ['Listings total', owners.properties.total],
            [
              'Available',
              `${owners.properties.available}${
                share(owners.properties.available, owners.properties.total)
                  ? ` (${share(owners.properties.available, owners.properties.total)})`
                  : ''
              }`,
            ],
            ['Under contract', owners.properties.under_contract],
            ['Sold', owners.properties.sold],
            ['Published to showcase', owners.properties.published],
            [
              'Value still available',
              owners.asking_value_available === null
                ? null
                : formatMoney(owners.asking_value_available),
            ],
            [
              'Average asking price',
              owners.asking_price_avg_available === null
                ? null
                : formatMoney(owners.asking_price_avg_available),
            ],
            ['Bids pending', owners.bids.pending],
            ['Bids accepted', owners.bids.accepted],
          ]),
          '',
          '## Buyers',
          '',
          bullets([
            ['With a portal login', buyers.linked_buyers],
            ['Stated a budget', buyers.buyers_with_budget],
            ['No budget ceiling', buyers.buyers_unconstrained_budget],
            ['Stated a requirement', buyers.buyers_with_requirement],
            [
              'Average budget',
              buyers.budget.max_avg === null
                ? null
                : formatMoney(buyers.budget.max_avg),
            ],
            [
              'Median budget',
              buyers.budget.max_median === null
                ? null
                : formatMoney(buyers.budget.max_median),
            ],
            [
              'Budget range',
              buyers.budget.max_lowest === null ||
              buyers.budget.max_highest === null
                ? null
                : `${formatMoney(buyers.budget.max_lowest)} – ${formatMoney(buyers.budget.max_highest)}`,
            ],
            [
              'Average floor',
              buyers.budget.min_avg === null
                ? null
                : formatMoney(buyers.budget.min_avg),
            ],
            ['Shortlisted items', buyers.shortlist.items],
            ['Buyers with a shortlist', buyers.shortlist.buyers_with_items],
          ]),
        ].join('\n');

        return renderRecord(
          'Portfolio summary',
          body,
          summary as unknown as Record<string, unknown>,
          response_format
        );
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_list_portfolio_owners',
    {
      title: 'List owners with a portal login',
      description: `List the workspace's property owners who have a Portfolio (owner portal) login, with the stock each of them holds.

Ranked by live stock, so the owners with the most sellable inventory come first. Each row carries their listing counts, the asking value of what is still available, open bids against their properties, and how often they receive a digest.

Agent-referred listings are excluded from these counts: on those, the owner field holds the referring agent rather than the owner, so counting them would credit the wrong person.

Use this to answer "which of my owners has the most stock sitting unsold?" or "who has bids waiting on them?".`,
      inputSchema: ListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<OwnerPortfolioRow>>(
          '/portfolio/owners',
          { limit: params.limit, offset: params.offset }
        );

        return renderPage({
          title: 'Portfolio owners',
          page: data,
          renderItem: (o) =>
            [
              `## ${o.name ?? '(unnamed owner)'}`,
              bullets([
                ['Contact id', o.contact_id],
                ['Phone', o.phone],
                [
                  'Listings',
                  `${o.properties.total} total · ${o.properties.available} available · ${o.properties.sold} sold`,
                ],
                [
                  'Value available',
                  o.asking_value_available === null
                    ? null
                    : formatMoney(o.asking_value_available),
                ],
                ['Bids pending', o.bids_pending || null],
                ['Digest', o.digest_frequency],
                ['Linked', formatDate(o.linked_at)],
              ]),
            ].join('\n'),
          emptyHint:
            'No owner in this workspace has a Portfolio login yet. Owners get one by verifying their WhatsApp number on the /den portal.',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.registerTool(
    'convoreal_list_portfolio_buyers',
    {
      title: 'List buyers with a portal login',
      description: `List the workspace's buyers who have a Portfolio (buyer portal) login, with their budget, stated brief and shortlist size.

Ranked by budget, highest first. Budget comes from the agency's own contact record — the same fields the matching engine reads — so the number here is the number that drives their matches.

A buyer marked "no ceiling" has explicitly said they have no budget limit; that is not the same as having stated nothing.

Use this to answer "who are my biggest buyers?" or "which portal buyers are actively shortlisting?". For what to show one of them, use convoreal_match_properties_for_contact with their contact id.`,
      inputSchema: ListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const data = await client.get<PageEnvelope<BuyerPortfolioRow>>(
          '/portfolio/buyers',
          { limit: params.limit, offset: params.offset }
        );

        return renderPage({
          title: 'Portfolio buyers',
          page: data,
          renderItem: (b) =>
            [
              `## ${b.name ?? '(unnamed buyer)'}`,
              bullets([
                ['Contact id', b.contact_id],
                ['Phone', b.phone],
                [
                  'Budget',
                  b.budget.unconstrained
                    ? 'no ceiling'
                    : b.budget.min || b.budget.max
                      ? `${formatMoney(b.budget.min)} – ${formatMoney(b.budget.max)}`
                      : null,
                ],
                ['Areas', b.areas_of_interest.join(', ')],
                ['Requirement', b.requirement_active ? b.requirements : null],
                ['Shortlisted', b.shortlist_count || null],
                ['Linked', formatDate(b.linked_at)],
              ]),
            ].join('\n'),
          emptyHint:
            'No buyer in this workspace has a Portfolio login yet. Buyers get one by verifying their WhatsApp number on the /buyer portal.',
          format: params.response_format,
        });
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
