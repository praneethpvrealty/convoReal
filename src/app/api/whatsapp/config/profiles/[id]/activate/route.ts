import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { activateNumberProfile } from '@/lib/whatsapp/number-profiles';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const data = await activateNumberProfile(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      profileId: id,
    });
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
