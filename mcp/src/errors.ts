// ============================================================
// Error translation.
//
// The reader of these messages is a model deciding what to do next, so
// each one says what happened AND what would fix it. "HTTP 403" tells
// an agent nothing; "this key is read-only, ask an admin for a write
// key" tells it to stop retrying and report back.
// ============================================================

export class ApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function describeStatus(
  status: number,
  path: string,
  detail?: string
): string {
  const suffix = detail ? ` Server said: ${detail}` : '';

  switch (status) {
    case 400:
      return `Invalid request to ${path}.${suffix}`;
    case 401:
      return `The API key was rejected. Check CONVOREAL_API_KEY is a current key (they start with 'cvr_sk_') and has not been revoked in Settings → API keys.${suffix}`;
    case 403:
      return `This API key is not allowed to do that — most often because it is read-only and the tool writes. Ask a workspace admin to issue a key with the 'write' scope.${suffix}`;
    case 404:
      return `Not found at ${path}. The id may belong to another workspace, or the record may have been deleted.${suffix}`;
    case 409:
      return `The request conflicts with what already exists.${suffix}`;
    case 429:
      return `Rate limited. The workspace allows 120 API calls a minute per key — wait a moment, and prefer one filtered search over many small ones.${suffix}`;
    case 500:
    case 502:
    case 503:
      return `ConvoReal returned a server error (HTTP ${status}) for ${path}. This is not something the request can fix — retry shortly, and report it if it persists.${suffix}`;
    default:
      return `Request to ${path} failed with HTTP ${status}.${suffix}`;
  }
}

/** Every tool handler funnels its failures through here, so a thrown
 *  error becomes a tool result the model can read rather than a
 *  protocol-level fault it cannot. */
export function toToolError(error: unknown): {
  isError: true;
  content: { type: 'text'; text: string }[];
} {
  const message =
    error instanceof ApiError
      ? error.message
      : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;

  return { isError: true, content: [{ type: 'text', text: message }] };
}
