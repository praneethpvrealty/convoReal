import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiVisibilityHealth } from '../../../e2e/ai-visibility-health.mjs';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const baseUrl = 'https://example.com';

function response(body: string, contentType: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

describe('AI visibility production health', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes a complete crawl, agent, provenance, and authority surface', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/robots.txt'))
          return response(
            `User-agent: *\nAllow: /api/public/agent/feed\nAllow: /api/public/agent/openapi.json\nSitemap: ${baseUrl}/sitemap.xml`,
            'text/plain'
          );
        if (url.endsWith('/llms.txt'))
          return response(
            `# Example Realty\n\n## Current published properties\n[Feed](${baseUrl}/api/public/agent/feed?account_id=${accountId})\n[OpenAPI](${baseUrl}/api/public/agent/openapi.json?account_id=${accountId})`,
            'text/plain'
          );
        if (url.includes('/api/public/agent/feed'))
          return response(
            JSON.stringify({
              data: [],
              pagination: { total: 0 },
              meta: {
                source: 'brokerage_published_inventory',
                generated_at: new Date().toISOString(),
                latest_result_update: null,
                privacy: 'Locations may be withheld.',
              },
            }),
            'application/json'
          );
        if (url.includes('/api/public/agent/openapi.json'))
          return response(
            JSON.stringify({
              paths: {
                '/api/public/agent/feed': {
                  get: { operationId: 'searchPublishedProperties' },
                },
                '/api/public/catalog-ask': {
                  post: { operationId: 'askAboutPublishedProperties' },
                },
                '/api/public/inquiry': {
                  post: {
                    operationId: 'createPropertyEnquiry',
                    requestBody: {
                      content: {
                        'application/json': {
                          schema: {
                            properties: {
                              source: { const: 'ai_agent' },
                              consentToContact: { const: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            }),
            'application/json'
          );
        if (url.endsWith('/sitemap.xml'))
          return response(
            `<urlset>${['property-sourcing', 'land-due-diligence', 'land-investment-advisory', 'commercial-property-advisory'].map((slug) => `<url><loc>${baseUrl}/services/${slug}</loc></url>`).join('')}<url><loc>${baseUrl}/property-consultants/bengaluru</loc></url></urlset>`,
            'application/xml'
          );
        if (url.includes('/services/'))
          return response(
            '<h1>Property sourcing</h1><script>schema.org Service FAQPage RealEstateAgent</script>',
            'text/html'
          );
        if (url.includes('/property-consultants/'))
          return response(
            '<h1>Property consultant in Bengaluru</h1><script>ItemList RealEstateAgent</script>',
            'text/html'
          );
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const report = await runAiVisibilityHealth(baseUrl);
    expect(report.status).toBe('passed');
    expect(report.summary).toEqual({ passed: 7, failed: 0, skipped: 0 });
  });

  it('reports an unsafe enquiry contract as a failed check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/robots.txt'))
          return response(
            `Allow: /api/public/agent/feed\nAllow: /api/public/agent/openapi.json\nSitemap: ${baseUrl}/sitemap.xml`,
            'text/plain'
          );
        if (url.endsWith('/llms.txt'))
          return response(
            `# Example\n## Current published properties\n[Feed](${baseUrl}/api/public/agent/feed?account_id=${accountId})\n[OpenAPI](${baseUrl}/api/public/agent/openapi.json?account_id=${accountId})`,
            'text/plain'
          );
        if (url.includes('/agent/feed'))
          return response(
            JSON.stringify({
              data: [],
              pagination: { total: 0 },
              meta: {
                source: 'brokerage_published_inventory',
                generated_at: 'now',
                privacy: 'withheld',
              },
            }),
            'application/json'
          );
        if (url.includes('/agent/openapi.json'))
          return response(
            JSON.stringify({
              paths: {
                '/api/public/agent/feed': {
                  get: { operationId: 'searchPublishedProperties' },
                },
                '/api/public/catalog-ask': {
                  post: { operationId: 'askAboutPublishedProperties' },
                },
                '/api/public/inquiry': {
                  post: {
                    operationId: 'createPropertyEnquiry',
                    requestBody: {
                      content: {
                        'application/json': {
                          schema: {
                            properties: {
                              source: { const: 'ai_agent' },
                              consentToContact: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            }),
            'application/json'
          );
        if (url.endsWith('/sitemap.xml'))
          return response(
            `<urlset><url><loc>${baseUrl}/property/example</loc></url>${['a', 'b', 'c', 'd'].map((slug) => `<url><loc>${baseUrl}/services/${slug}</loc></url>`).join('')}</urlset>`,
            'application/xml'
          );
        if (url.includes('/services/'))
          return response(
            '<h1>Service</h1> schema.org FAQPage RealEstateAgent',
            'text/html'
          );
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const report = await runAiVisibilityHealth(baseUrl);
    expect(report.status).toBe('failed');
    const consentCheck = report.checks.find((check) =>
      check.name.includes('consent')
    );
    expect(
      consentCheck && 'error' in consentCheck ? consentCheck.error : null
    ).toContain('consent');
  });
});
