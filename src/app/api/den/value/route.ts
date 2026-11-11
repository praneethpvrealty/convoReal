import { NextResponse } from 'next/server';

import { UserFacingError } from '@/lib/auth/account';
import { withDenAuth } from '@/lib/den/auth';
import {
  loadOwnerPortfolioValue,
  saveOwnerDeclaredValue,
} from '@/lib/den/value';
import { parseDeclaredValue } from '@/lib/den/value-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withDenAuth(async (ctx) => {
  try {
    return NextResponse.json(await loadOwnerPortfolioValue(ctx));
  } catch (err) {
    console.error('[den/value GET] failed:', err);
    return NextResponse.json(
      { error: 'Could not load your portfolio value' },
      { status: 500 }
    );
  }
});

export const PUT = withDenAuth(async (ctx, req) => {
  const body = (await req.json().catch(() => null)) as {
    property_id?: unknown;
    declared_value?: unknown;
  } | null;
  if (
    !body ||
    typeof body.property_id !== 'string' ||
    !UUID.test(body.property_id)
  ) {
    throw new UserFacingError('Invalid property');
  }
  const value = parseDeclaredValue(body.declared_value);
  if (value === undefined) {
    throw new UserFacingError('Enter a value in rupees, or clear it');
  }

  let outcome: Awaited<ReturnType<typeof saveOwnerDeclaredValue>>;
  try {
    outcome = await saveOwnerDeclaredValue(ctx, body.property_id, value);
  } catch (err) {
    console.error('[den/value PUT] failed:', err);
    return NextResponse.json(
      { error: 'Could not save your value' },
      { status: 500 }
    );
  }
  if (outcome === 'not_found') {
    throw new UserFacingError('Property not found', 404);
  }
  return NextResponse.json(await loadOwnerPortfolioValue(ctx));
});
