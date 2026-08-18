import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://www.convoreal.com';
const TIMEOUT_MS = 20_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  assert(
    ['http:', 'https:'].includes(url.protocol),
    'Base URL must use HTTP or HTTPS'
  );
  return url.origin;
}

function absoluteUrl(value, baseUrl) {
  return new URL(value.replace(/&amp;/g, '&'), baseUrl).toString();
}

function linksFromText(value) {
  return Array.from(
    value.matchAll(/\((https?:\/\/[^)]+)\)/g),
    (match) => match[1]
  );
}

function sitemapUrls(value) {
  return Array.from(
    value.matchAll(/<loc>([^<]+)<\/loc>/g),
    (match) => match[1]
  );
}

async function request(url, expectedContentType) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ConvoReal-AI-Visibility-Monitor/1.0',
      Accept: '*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  assert(response.ok, `${url} returned ${response.status}`);
  if (expectedContentType) {
    assert(
      response.headers.get('content-type')?.includes(expectedContentType),
      `${url} did not return ${expectedContentType}`
    );
  }
  return {
    url: response.url,
    status: response.status,
    contentType: response.headers.get('content-type'),
    durationMs: Date.now() - startedAt,
    body,
  };
}

async function check(name, action, results) {
  try {
    const evidence = await action();
    results.push({ name, status: 'passed', ...evidence });
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runAiVisibilityHealth(baseUrlInput) {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const results = [];
  let llmsText = '';
  let sitemap = [];
  let feedUrl = '';
  let openApiUrl = '';
  let publishedListings = 0;

  await check(
    'Crawler access and sitemap declaration',
    async () => {
      const result = await request(`${baseUrl}/robots.txt`, 'text/plain');
      assert(
        /Sitemap:\s*https?:\/\//i.test(result.body),
        'robots.txt has no absolute sitemap declaration'
      );
      assert(
        !/Disallow:\s*\/llms\.txt/i.test(result.body),
        'robots.txt blocks llms.txt'
      );
      assert(
        /Allow:\s*\/api\/public\/agent\/feed/i.test(result.body),
        'robots.txt does not explicitly allow the agent feed'
      );
      assert(
        /Allow:\s*\/api\/public\/agent\/openapi\.json/i.test(result.body),
        'robots.txt does not explicitly allow the OpenAPI contract'
      );
      return {
        url: result.url,
        statusCode: result.status,
        durationMs: result.durationMs,
      };
    },
    results
  );

  await check(
    'Machine-readable brokerage description',
    async () => {
      const result = await request(`${baseUrl}/llms.txt`, 'text/plain');
      llmsText = result.body;
      const links = linksFromText(llmsText);
      feedUrl =
        links.find((url) => url.includes('/api/public/agent/feed')) || '';
      openApiUrl =
        links.find((url) => url.includes('/api/public/agent/openapi.json')) ||
        '';
      assert(/^#\s+\S+/m.test(llmsText), 'llms.txt has no brokerage heading');
      assert(feedUrl, 'llms.txt does not link the live property feed');
      assert(openApiUrl, 'llms.txt does not link the OpenAPI contract');
      assert(
        /current published properties/i.test(llmsText),
        'llms.txt has no current inventory section'
      );
      return {
        url: result.url,
        statusCode: result.status,
        durationMs: result.durationMs,
      };
    },
    results
  );

  await check(
    'Published inventory provenance',
    async () => {
      assert(feedUrl, 'Skipped because llms.txt did not supply a feed URL');
      const result = await request(
        absoluteUrl(feedUrl, baseUrl),
        'application/json'
      );
      const feed = JSON.parse(result.body);
      assert(Array.isArray(feed.data), 'Property feed data is not an array');
      assert(
        feed.pagination && typeof feed.pagination.total === 'number',
        'Property feed has no total'
      );
      assert(
        feed.meta?.source === 'brokerage_published_inventory',
        'Property feed has no brokerage provenance'
      );
      assert(
        feed.meta?.generated_at,
        'Property feed has no generation timestamp'
      );
      assert(feed.meta?.privacy, 'Property feed has no privacy disclosure');
      publishedListings = feed.pagination.total;
      return {
        url: result.url,
        statusCode: result.status,
        durationMs: result.durationMs,
        publishedListings: feed.pagination.total,
        latestResultUpdate: feed.meta.latest_result_update,
      };
    },
    results
  );

  await check(
    'Agent actions and enquiry consent contract',
    async () => {
      assert(
        openApiUrl,
        'Skipped because llms.txt did not supply an OpenAPI URL'
      );
      const result = await request(
        absoluteUrl(openApiUrl, baseUrl),
        'application/json'
      );
      const document = JSON.parse(result.body);
      const feed = document.paths?.['/api/public/agent/feed']?.get;
      const question = document.paths?.['/api/public/catalog-ask']?.post;
      const inquiry = document.paths?.['/api/public/inquiry']?.post;
      assert(
        feed?.operationId === 'searchPublishedProperties',
        'Property search action is missing'
      );
      assert(
        question?.operationId === 'askAboutPublishedProperties',
        'Grounded Q&A action is missing'
      );
      assert(
        inquiry?.operationId === 'createPropertyEnquiry',
        'Enquiry action is missing'
      );
      const schema = inquiry.requestBody?.content?.['application/json']?.schema;
      assert(
        schema?.properties?.source?.const === 'ai_agent',
        'Enquiry source is not constrained'
      );
      assert(
        schema?.properties?.consentToContact?.const === true,
        'Explicit contact consent is not required'
      );
      return {
        url: result.url,
        statusCode: result.status,
        durationMs: result.durationMs,
      };
    },
    results
  );

  await check(
    'Sitemap authority discovery',
    async () => {
      const result = await request(`${baseUrl}/sitemap.xml`, 'application/xml');
      sitemap = sitemapUrls(result.body);
      const services = sitemap.filter((url) => url.includes('/services/'));
      assert(
        services.length >= 4,
        'Sitemap contains fewer than four authority service pages'
      );
      if (publishedListings > 0) {
        assert(
          sitemap.some((url) => url.includes('/property/')),
          'Published inventory exists but the sitemap contains no public property pages'
        );
      }
      return {
        url: result.url,
        statusCode: result.status,
        durationMs: result.durationMs,
        sitemapUrls: sitemap.length,
        servicePages: services.length,
        consultantPages: sitemap.filter((url) =>
          url.includes('/property-consultants/')
        ).length,
      };
    },
    results
  );

  await check(
    'Visible service authority and structured data',
    async () => {
      const serviceUrl = sitemap.find((url) => url.includes('/services/'));
      assert(serviceUrl, 'Skipped because the sitemap has no service page');
      const result = await request(
        absoluteUrl(serviceUrl, baseUrl),
        'text/html'
      );
      assert(
        /<h1[^>]*>[^<]+<\/h1>/i.test(result.body),
        'Service page has no visible H1'
      );
      assert(
        result.body.includes('schema.org'),
        'Service page has no structured data'
      );
      assert(
        result.body.includes('FAQPage'),
        'Service page has no FAQ structured data'
      );
      assert(
        result.body.includes('RealEstateAgent'),
        'Service page has no brokerage entity'
      );
      return {
        url: result.url,
        statusCode: result.status,
        durationMs: result.durationMs,
      };
    },
    results
  );

  const consultantUrl = sitemap.find((url) =>
    url.includes('/property-consultants/')
  );
  if (consultantUrl) {
    await check(
      'Inventory-grounded consultant locality page',
      async () => {
        const result = await request(
          absoluteUrl(consultantUrl, baseUrl),
          'text/html'
        );
        assert(
          /property consultant in/i.test(result.body),
          'Consultant page lacks locality authority text'
        );
        assert(
          result.body.includes('ItemList'),
          'Consultant page has no inventory list structured data'
        );
        assert(
          result.body.includes('RealEstateAgent'),
          'Consultant page has no brokerage entity'
        );
        return {
          url: result.url,
          statusCode: result.status,
          durationMs: result.durationMs,
        };
      },
      results
    );
  } else {
    results.push({
      name: 'Inventory-grounded consultant locality page',
      status: 'skipped',
      reason:
        'No published listing currently has a city, so no locality page should exist.',
    });
  }

  const failures = results.filter((result) => result.status === 'failed');
  return {
    checkedAt: new Date().toISOString(),
    baseUrl,
    status: failures.length === 0 ? 'passed' : 'failed',
    summary: {
      passed: results.filter((result) => result.status === 'passed').length,
      failed: failures.length,
      skipped: results.filter((result) => result.status === 'skipped').length,
    },
    checks: results,
  };
}

async function main() {
  const report = await runAiVisibilityHealth(process.env.E2E_BASE_URL);
  const outputDirectory = 'test-results/ai-visibility-health';
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    `${outputDirectory}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`
  );

  console.log(`AI visibility health: ${report.status}`);
  for (const result of report.checks) {
    const marker =
      result.status === 'passed'
        ? '✓'
        : result.status === 'skipped'
          ? '–'
          : '✗';
    console.log(
      `${marker} ${result.name}${result.error ? `: ${result.error}` : ''}`
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.checks
      .map(
        (result) =>
          `| ${result.status} | ${result.name} | ${result.error || result.reason || result.url || ''} |`
      )
      .join('\n');
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## AI visibility health: ${report.status}\n\n| Result | Check | Evidence |\n| --- | --- | --- |\n${rows}\n`,
      { flag: 'a' }
    );
  }

  if (report.status === 'failed') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
