import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { syncAgentSourceInventory } from '@/lib/agents/source-inventory-sync';

export async function POST() {
  try {
    const ctx = await requireRole('agent');
    const result = await syncAgentSourceInventory(ctx);
    return NextResponse.json({ data: result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
