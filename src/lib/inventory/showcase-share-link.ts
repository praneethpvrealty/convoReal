import {
  showcaseScopeParams,
  type ShowcaseScopeOptions,
} from './showcase-share-scope';

export type {
  ShareCategory,
  ShareScope,
  ShowcaseScopeOptions,
} from './showcase-share-scope';

export interface ShowcaseShareLinkOptions extends ShowcaseScopeOptions {
  /** Origin the showcase is served from, e.g. https://acme.convoreal.com */
  baseUrl: string;
  /** Appended as ?ref= when the account has no showcase subdomain. */
  accountId?: string | null;
  includeRef: boolean;
}

/** The web dialog's link: the shared scope rule on a URL object, after
 *  the ref the account needs when it has no showcase subdomain. */
export function buildShowcaseShareLink({
  baseUrl,
  accountId,
  includeRef,
  ...scope
}: ShowcaseShareLinkOptions): string {
  const url = new URL(baseUrl);

  if (includeRef && accountId) url.searchParams.set('ref', accountId);
  for (const [key, value] of showcaseScopeParams(scope)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}
