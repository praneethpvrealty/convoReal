import { NextResponse } from 'next/server';
import {
  buildPublicAgentOpenApi,
  loadPublicAgentContext,
} from '@/lib/agent/publicInterface';

export async function GET(request: Request) {
  const context = await loadPublicAgentContext(request);
  if (!context) {
    return NextResponse.json(
      { error: 'No public property catalog is configured for this host.' },
      { status: 404 }
    );
  }

  return NextResponse.json(
    buildPublicAgentOpenApi({
      origin: context.origin,
      accountId: context.accountId,
      businessName: context.businessName,
      description: context.profile.description,
      requiresCatalogApiKey: false,
    }),
    {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    }
  );
}
