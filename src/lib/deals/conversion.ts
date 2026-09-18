import type { JourneyStageKind } from '@/types';

/**
 * Journey → Deal conversion. Journey is the pre-commercial layer (what
 * a buyer is considering); a deal is the closing record for one
 * property. Converting copies nothing that lives on the journey — it
 * creates the deal, points it at the item through
 * `source_journey_item_id`, and writes the hand-off on both timelines.
 */

export interface ConvertibleJourneyItem {
  id: string;
  contact_id: string;
  property_id: string;
  stage_id: string;
  status: 'active' | 'dropped';
  contact: { name: string | null; phone: string | null } | null;
  property: { title: string | null; unit_no?: string | null; price: number | null } | null;
}

export interface ConversionStage {
  id: string;
  name: string;
  position: number;
}

/**
 * Where the new card lands. A journey already at token or legal maps
 * onto the board's negotiation/token or diligence stage when the board
 * has one; anything else starts at the first stage. Never a terminal
 * stage: conversion opens a deal, it does not close one.
 */
export function defaultStageForConversion(
  stages: readonly ConversionStage[],
  journeyStageKind: JourneyStageKind
): ConversionStage | null {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return null;
  if (journeyStageKind === 'closing' || journeyStageKind === 'won') {
    const closing = ordered.find((s) => {
      const n = s.name.toLowerCase();
      return (
        n.includes('token') ||
        n.includes('negotiat') ||
        n.includes('diligence') ||
        n.includes('contract')
      );
    });
    if (closing) return closing;
  }
  return ordered[0];
}

export function conversionTitle(item: ConvertibleJourneyItem): string {
  const who = item.contact?.name?.trim() || item.contact?.phone?.trim() || 'Buyer';
  const what =
    item.property?.unit_no?.trim()
      ? `Property No. ${item.property.unit_no.trim()}`
      : item.property?.title?.trim() || 'Property';
  return `${who} — ${what}`.slice(0, 200);
}

export interface ConversionDealRow {
  account_id: string;
  user_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string;
  property_id: string;
  title: string;
  value: number;
  currency: string;
  status: 'open';
  source_journey_item_id: string;
}

export function buildConversionDeal(args: {
  item: ConvertibleJourneyItem;
  accountId: string;
  userId: string;
  pipelineId: string;
  stageId: string;
  title?: string | null;
  currency?: string;
}): ConversionDealRow {
  const { item, accountId, userId, pipelineId, stageId } = args;
  const title = args.title?.trim() || conversionTitle(item);
  return {
    account_id: accountId,
    user_id: userId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: item.contact_id,
    property_id: item.property_id,
    title,
    value: Number(item.property?.price ?? 0) || 0,
    currency: args.currency ?? 'INR',
    status: 'open',
    source_journey_item_id: item.id,
  };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseConversionInput(
  raw: unknown
): ParseResult<{ itemId: string; pipelineId: string | null; title: string | null; source: 'web' | 'mobile' }> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'item_id is required' };
  const input = raw as Record<string, unknown>;
  const itemId = typeof input.item_id === 'string' ? input.item_id.trim() : '';
  if (!itemId) return { ok: false, error: 'item_id is required' };
  const pipelineId =
    typeof input.pipeline_id === 'string' && input.pipeline_id.trim()
      ? input.pipeline_id.trim()
      : null;
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, 200)
      : null;
  const source = input.source === 'mobile' ? 'mobile' : 'web';
  return { ok: true, value: { itemId, pipelineId, title, source } };
}
