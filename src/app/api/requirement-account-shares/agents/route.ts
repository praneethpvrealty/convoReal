import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { listRegisteredAgentContacts } from '@/lib/inventory/agent-account-share';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    return NextResponse.json({
      data: await listRegisteredAgentContacts(ctx),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
