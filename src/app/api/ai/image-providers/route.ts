import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getImageProvidersStatus } from '@/lib/ai/provider-status';

// GET /api/ai/image-providers
// Reports which flyer image providers are usable on this deployment
// so the settings panel can disable the ones that are not. Returns
// only booleans to tenants; env-var names are included on self-hosted
// deployments, where the reader can act on them.
export async function GET() {
  try {
    await requireRole('agent');
    return NextResponse.json({ data: getImageProvidersStatus() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
