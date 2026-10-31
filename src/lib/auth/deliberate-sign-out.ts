const DELIBERATE_SIGN_OUT_KEY = 'convoreal:deliberate-sign-out';
const DELIBERATE_SIGN_OUT_WINDOW_MS = 60_000;

export function markDeliberateSignOut(now: number = Date.now()): void {
  try {
    localStorage.setItem(DELIBERATE_SIGN_OUT_KEY, String(now));
  } catch {}
}

export function isDeliberateSignOut(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DELIBERATE_SIGN_OUT_KEY));
    return at > 0 && now - at < DELIBERATE_SIGN_OUT_WINDOW_MS;
  } catch {
    return false;
  }
}

export function clearDeliberateSignOut(): void {
  try {
    localStorage.removeItem(DELIBERATE_SIGN_OUT_KEY);
  } catch {}
}
