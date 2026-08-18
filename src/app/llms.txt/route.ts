import {
  buildLlmsText,
  loadPublicAgentContext,
} from '@/lib/agent/publicInterface';

export async function GET(request: Request) {
  const context = await loadPublicAgentContext(request);
  if (!context) {
    return new Response(
      '# Property catalog\n\nNo public catalog is configured.',
      {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }
    );
  }

  return new Response(
    buildLlmsText({
      origin: context.origin,
      accountId: context.accountId,
      businessName: context.businessName,
      profile: context.profile,
      properties: context.properties,
    }),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    }
  );
}
