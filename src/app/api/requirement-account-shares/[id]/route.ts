import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  declineRequirementAccountShare,
  getRequirementAccountShare,
} from '@/lib/requirements/account-share';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    return NextResponse.json({
      data: await getRequirementAccountShare(ctx, id),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const [{ id }, body] = await Promise.all([
      params,
      request.json().catch(() => null),
    ]);
    if (body?.action !== 'decline') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
    await declineRequirementAccountShare(ctx, id);
    return NextResponse.json({ data: { id, status: 'declined' } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
