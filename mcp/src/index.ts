#!/usr/bin/env node
// ============================================================
// ConvoReal MCP server.
//
// Exposes one workspace's inventory, contacts, matching, pipeline and
// agenda to an MCP client. It is a client of /api/v1 and nothing else:
// no database connection, no Supabase key, no business logic. Rules
// live in the Next.js app, so what this server reports and what the
// dashboard shows cannot drift apart.
//
// stdio transport, deliberately. A hosted remote server would need
// OAuth 2.1 with dynamic client registration; running locally against
// a per-account API key gets the same tools in front of a user today
// without that. Logging goes to stderr — stdout is the protocol
// channel and anything written there corrupts the session.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ConvoRealClient } from './client.js';
import { registerContactTools } from './tools/contacts.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerPropertyTools } from './tools/properties.js';
import { registerWorkspaceTools } from './tools/workspace.js';

const VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'https://www.convoreal.com';
const KEY_PREFIX = 'cvr_sk_';

export interface ResolvedConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Read configuration from the environment, failing with a message that
 * says how to fix it. Misconfiguration is the overwhelmingly common
 * first-run failure, and an MCP client surfaces a failed launch as a
 * silent missing server — so the error text has to carry its own
 * instructions.
 */
export function resolveConfig(env: NodeJS.ProcessEnv): ResolvedConfig {
  const apiKey = env.CONVOREAL_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      'CONVOREAL_API_KEY is not set. Create a key in ConvoReal under Settings → API keys ' +
        '(admin only), then set it in your MCP client config.'
    );
  }
  if (!apiKey.startsWith(KEY_PREFIX)) {
    throw new Error(
      `CONVOREAL_API_KEY does not look like a ConvoReal key — they start with '${KEY_PREFIX}'. ` +
        'A Supabase token or session cookie will not work here.'
    );
  }

  const rawBase = env.CONVOREAL_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let baseUrl: string;
  try {
    baseUrl = new URL(rawBase).origin;
  } catch {
    throw new Error(
      `CONVOREAL_BASE_URL is not a valid URL: '${rawBase}'. Use an origin such as ` +
        "'https://www.convoreal.com' or 'http://localhost:3000'."
    );
  }

  return { baseUrl, apiKey };
}

export function createServer(client: ConvoRealClient): McpServer {
  const server = new McpServer({
    name: 'convoreal-mcp-server',
    version: VERSION,
  });

  registerPropertyTools(server, client);
  registerContactTools(server, client);
  registerWorkspaceTools(server, client);
  registerPortfolioTools(server, client);

  return server;
}

async function main(): Promise<void> {
  const config = resolveConfig(process.env);
  const server = createServer(new ConvoRealClient(config));

  await server.connect(new StdioServerTransport());
  console.error(`convoreal-mcp-server ${VERSION} ready (${config.baseUrl})`);
}

// `import.meta.url` guard so the module can be imported by tests
// without starting a transport.
const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
