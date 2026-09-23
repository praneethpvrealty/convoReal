import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { computeValuation } from '@/lib/guidance-value/match';
import { sanitiseSchedule } from '@/lib/guidance-value/schedule';
import { parseValuationOptions } from '@/lib/guidance-value/schedule-fields';
import type { AreaUnit, PropertyClass } from '@/lib/guidance-value/types';
import { supabaseAdmin } from '@/lib/supabase/admin';

const SAVED_COLUMNS =
  'id, property_id, deal_id, schedule, rate_id, rate_snapshot, land_area_sqft, built_up_area_sqft, land_value, building_value, total_value, created_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

// GET /api/guidance-value/saved?property_id=…|deal_id=…
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    const propertyId = uuidOrNull(url.searchParams.get('property_id'));
    const dealId = uuidOrNull(url.searchParams.get('deal_id'));
    if (!propertyId && !dealId) {
      return NextResponse.json(
        { error: 'property_id or deal_id is required' },
        { status: 400 }
      );
    }

    let query = ctx.supabase
      .from('property_guidance_values')
      .select(SAVED_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(20);
    query = propertyId
      ? query.eq('property_id', propertyId)
      : query.eq('deal_id', dealId as string);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/guidance-value/saved
//
// The value is recomputed here from the stored rate; a total sent by the
// client is never trusted.
export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');
    const body = await request.json().catch(() => null);
    const rateId = uuidOrNull(body?.rate_id);
    let propertyId = uuidOrNull(body?.property_id);
    const dealId = uuidOrNull(body?.deal_id);
    if (!rateId || (!propertyId && !dealId)) {
      return NextResponse.json(
        { error: 'rate_id and a property_id or deal_id are required' },
        { status: 400 }
      );
    }

    if (dealId) {
      const { data: deal } = await ctx.supabase
        .from('deals')
        .select('id, property_id')
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!deal) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      }
      propertyId = propertyId ?? (deal.property_id as string | null);
    }
    if (propertyId) {
      const { data: property } = await ctx.supabase
        .from('properties')
        .select('id')
        .eq('id', propertyId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!property) {
        return NextResponse.json(
          { error: 'Property not found' },
          { status: 404 }
        );
      }
    }

    const { data: rate } = await supabaseAdmin()
      .from('guidance_value_rates')
      .select(
        'id, district, taluk, hobli, village, locality, road, survey_numbers, property_class, rate, unit, page, source:guidance_value_sources(title, effective_from)'
      )
      .eq('id', rateId)
      .maybeSingle();
    if (!rate) {
      return NextResponse.json({ error: 'Rate not found' }, { status: 404 });
    }

    const schedule = sanitiseSchedule(body?.schedule);
    const options = parseValuationOptions(body?.options);
    const valuation = computeValuation(
      schedule,
      {
        rate: Number(rate.rate),
        unit: rate.unit as AreaUnit,
        property_class: rate.property_class as PropertyClass,
      },
      options
    );
    if (valuation.total_value === null) {
      return NextResponse.json(
        {
          error:
            valuation.basis === 'land'
              ? 'Enter the land area before saving.'
              : 'Enter the built-up area before saving.',
          code: 'AREA_REQUIRED',
        },
        { status: 400 }
      );
    }

    const source = Array.isArray(rate.source) ? rate.source[0] : rate.source;

    const { data, error } = await ctx.supabase
      .from('property_guidance_values')
      .insert({
        account_id: ctx.accountId,
        property_id: propertyId,
        deal_id: dealId,
        schedule,
        rate_id: rate.id,
        rate_snapshot: {
          district: rate.district,
          taluk: rate.taluk,
          hobli: rate.hobli,
          village: rate.village,
          locality: rate.locality,
          road: rate.road,
          survey_numbers: rate.survey_numbers,
          property_class: rate.property_class,
          unit: rate.unit,
          page: rate.page,
          rate: Number(rate.rate),
          source_title: source?.title ?? null,
          effective_from: source?.effective_from ?? null,
        },
        land_area_sqft: valuation.basis === 'land' ? valuation.area_sqft : null,
        built_up_area_sqft:
          options.built_up_area_sqft ??
          (valuation.basis === 'built_up' ? valuation.area_sqft : null),
        land_value: valuation.land_value,
        building_value: valuation.building_value,
        total_value: valuation.total_value,
        created_by: ctx.userId,
      })
      .select(SAVED_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
