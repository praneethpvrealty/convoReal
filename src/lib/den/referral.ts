export const DEN_REFERRAL_STORAGE_KEY = 'convoreal:den-referral';

const REFERRAL_SOURCE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function normalizeReferralSource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return REFERRAL_SOURCE.test(value) ? value : null;
}

export function rememberReferralSource(search: string): void {
  const source = normalizeReferralSource(
    new URLSearchParams(search).get('ref')
  );
  if (!source) return;
  try {
    window.localStorage.setItem(DEN_REFERRAL_STORAGE_KEY, source);
  } catch {
    return;
  }
}

export function pendingReferralSource(): string | null {
  try {
    return normalizeReferralSource(
      window.localStorage.getItem(DEN_REFERRAL_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function clearReferralSource(): void {
  try {
    window.localStorage.removeItem(DEN_REFERRAL_STORAGE_KEY);
  } catch {
    return;
  }
}

export async function postDenAuthComplete(): Promise<Response> {
  const source = pendingReferralSource();
  const res = await fetch('/api/den/auth/complete', {
    method: 'POST',
    ...(source
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referral_source: source }),
        }
      : {}),
  });
  if (res.ok) clearReferralSource();
  return res;
}
