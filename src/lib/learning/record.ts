// ============================================================
// The one way a learned fact reaches a record.
//
// Every learner — the agent-reply price reader, the buyer preference
// extractor, the owner quote-reply editor — hands its candidates here
// and the field policy decides the rest: whitelist, bounds, novelty,
// apply-or-propose, audit. A learner that wants different behaviour
// changes fields.ts, not this.
//
// Nothing here throws. Learning runs behind a message that has already
// been sent; a failure to file what someone said must never surface to
// the person who said it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dispositionForSource,
  fieldPolicy,
  guardedListValue,
  normalizeValue,
  valuesDiffer,
  type LearnedEntity,
  type LearnedFactSource,
} from './fields';

const TABLE: Record<LearnedEntity, string> = {
  property: 'properties',
  contact: 'contacts',
};

/** One thing a learner believes about a record. */
export interface FactCandidate {
  field: string;
  value: unknown;
}

export interface RecordFactsArgs {
  db: SupabaseClient;
  accountId: string;
  entity: LearnedEntity;
  entityId: string;
  /** The record as it reads now, for the novelty check and the
   *  before-value on the audit row. */
  current: Record<string, unknown>;
  facts: FactCandidate[];
  /** The sentence these were read out of. */
  evidence: string;
  source: LearnedFactSource;
  contactId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}

export interface RecordFactsResult {
  /** Written to the record and audited. */
  applied: string[];
  /** Queued for a human. Nothing was written. */
  proposed: string[];
}

interface PreparedFact {
  field: string;
  column: string;
  value: unknown;
  previous: unknown;
  disposition: 'auto' | 'propose';
}

/**
 * Whitelist → coerce → bound → novelty. Everything a learner offers
 * that survives all four is worth acting on; everything else is
 * dropped silently, which is the correct volume of noise for a model
 * that guessed.
 *
 * Exported for tests: this is the gate, and it should be provable
 * without a database.
 */
export function prepareFacts(
  entity: LearnedEntity,
  current: Record<string, unknown>,
  facts: FactCandidate[],
  /** The sentence these were read out of. Removals from an
   *  auto-applied list need it; without one, none are allowed. */
  evidence = '',
  /** Which learner produced these. Decides apply-vs-propose together
   *  with the field policy — see `dispositionForSource`. Defaults to the
   *  in-the-moment agent path, which is the historical behaviour. */
  source: LearnedFactSource = 'agent_reply'
): PreparedFact[] {
  const seen = new Set<string>();
  const out: PreparedFact[] = [];

  for (const fact of facts) {
    if (seen.has(fact.field)) continue;
    const policy = fieldPolicy(entity, fact.field);
    if (!policy) continue;

    const disposition = dispositionForSource(policy, source);

    // A fact whose apply is not a column write can never be 'auto':
    // the auto path issues one UPDATE, and silently dropping such a
    // field from it would audit a change that never happened.
    const applyAs = policy.applyAs ?? 'column';
    if (applyAs !== 'column' && disposition === 'auto') continue;

    const normalized = normalizeValue(policy, fact.value);
    if (normalized === null) continue;

    // Keyed by column for a column write, by field otherwise — `tags`
    // has no column, and its "current" is the attached tag names.
    const currentKey = applyAs === 'column' ? policy.column : policy.field;
    const previous = current[currentKey] ?? null;

    // A removal from a list nobody reviews needs the evidence to name
    // what is being removed. Proposed fields are exempt: a person sees
    // those before they land, so a wrong deletion is caught.
    const value =
      policy.kind === 'list' &&
      disposition === 'auto' &&
      Array.isArray(normalized)
        ? guardedListValue(previous, normalized as string[], evidence)
        : normalized;

    if (!valuesDiffer(previous, value)) continue;

    seen.add(fact.field);
    out.push({
      field: policy.field,
      column: policy.column,
      value,
      previous,
      disposition,
    });
  }

  return out;
}

/**
 * Files what was learned. Auto fields are written to the record here —
 * callers must NOT write them separately, or the audit row's
 * `previous_value` will record a change that had already happened.
 */
export async function recordLearnedFacts(
  args: RecordFactsArgs
): Promise<RecordFactsResult> {
  const empty: RecordFactsResult = { applied: [], proposed: [] };

  try {
    const prepared = prepareFacts(
      args.entity,
      args.current,
      args.facts,
      args.evidence,
      args.source
    );
    if (!prepared.length) return empty;

    const auto = prepared.filter((f) => f.disposition === 'auto');
    const propose = prepared.filter((f) => f.disposition === 'propose');
    const now = new Date().toISOString();

    const common = {
      account_id: args.accountId,
      entity_type: args.entity,
      entity_id: args.entityId,
      evidence: args.evidence.slice(0, 2000),
      source: args.source,
      contact_id: args.contactId ?? null,
      conversation_id: args.conversationId ?? null,
      message_id: args.messageId ?? null,
    };

    if (auto.length) {
      const patch = Object.fromEntries(auto.map((f) => [f.column, f.value]));
      // .select() because an RLS refusal returns zero rows and no
      // error: without it a refused write would be audited as applied.
      const { data: written, error: writeErr } = await args.db
        .from(TABLE[args.entity])
        .update(patch)
        .eq('id', args.entityId)
        .eq('account_id', args.accountId)
        .select('id');

      if (writeErr || !written?.length) {
        console.error('[learning] auto-apply failed:', writeErr);
      } else {
        const { error: auditErr } = await args.db.from('learned_facts').insert(
          auto.map((f) => ({
            ...common,
            field: f.field,
            previous_value: f.previous,
            value: f.value,
            disposition: 'auto',
            status: 'applied',
            reviewed_at: now,
          }))
        );
        if (auditErr) console.error('[learning] audit write failed:', auditErr);
      }
    }

    if (propose.length) {
      // The latest thing said is the one worth confirming, so an open
      // question on the same field steps aside rather than queueing
      // behind. Reviewed rows are untouched — they are the record of
      // what was decided.
      const { error: clearErr } = await args.db
        .from('learned_facts')
        .update({ status: 'rejected', reviewed_at: now })
        .eq('account_id', args.accountId)
        .eq('entity_type', args.entity)
        .eq('entity_id', args.entityId)
        .eq('status', 'pending')
        .in(
          'field',
          propose.map((f) => f.field)
        );
      if (clearErr) throw clearErr;

      const { error: insertErr } = await args.db.from('learned_facts').insert(
        propose.map((f) => ({
          ...common,
          field: f.field,
          previous_value: f.previous,
          value: f.value,
          disposition: 'propose',
          status: 'pending',
        }))
      );
      if (insertErr) throw insertErr;
    }

    return {
      applied: auto.map((f) => f.field),
      proposed: propose.map((f) => f.field),
    };
  } catch (err) {
    console.error('[learning] recordLearnedFacts failed (non-fatal):', err);
    return empty;
  }
}
