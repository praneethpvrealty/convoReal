// ============================================================
// HTTP client for the ConvoReal /api/v1 surface.
//
// Every tool goes through here, so authentication, timeouts and error
// translation are written once. The server holds no Supabase
// credentials and talks to no database — it is a client of the same
// API the mobile app uses, which is what keeps business rules in
// src/lib and out of this package.
// ============================================================

import { ApiError, describeStatus } from './errors.js';

const REQUEST_TIMEOUT_MS = 30_000;

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
}

export type QueryValue = string | number | boolean | undefined | null;

export class ConvoRealClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor({ baseUrl, apiKey }: ClientConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async get<T>(
    path: string,
    params: Record<string, QueryValue> = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    return this.request<T>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError(
          `Request to ${url.pathname} timed out after ${REQUEST_TIMEOUT_MS / 1000}s. The workspace may be under load — retry, or narrow the query with filters.`
        );
      }
      throw new ApiError(
        `Could not reach ConvoReal at ${this.baseUrl}. Check CONVOREAL_BASE_URL and that the server is running. (${
          error instanceof Error ? error.message : String(error)
        })`
      );
    } finally {
      clearTimeout(timer);
    }

    const payload = await this.parseBody(response);

    if (!response.ok) {
      const detail =
        typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : undefined;
      throw new ApiError(
        describeStatus(response.status, url.pathname, detail),
        response.status
      );
    }

    return payload as T;
  }

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // A non-JSON body from a JSON API means something upstream
      // answered instead — a proxy error page, an auth redirect. Say
      // that rather than surfacing a parse error.
      throw new ApiError(
        `ConvoReal returned a non-JSON response (HTTP ${response.status}). This usually means CONVOREAL_BASE_URL points at something other than the app — check it does not include a path or a trailing /api.`,
        response.status
      );
    }
  }
}
