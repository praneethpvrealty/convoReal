// ============================================================
// Sidebar favourites — localStorage owner.
//
// The key was renamed `crm_favorites` → `convoreal_favorites` when
// "CRM" was dropped from the product vocabulary. The old key holds
// real user data (every favourite a user has ever starred), so
// `readFavorites` migrates it on first read rather than orphaning it:
// old key is copied to the new one, then removed. Both call sites go
// through here so the migration can't run in one and not the other.
//
// LEGACY_KEY can be deleted once every active session has loaded the
// app at least once after this ships.
// ============================================================

const KEY = "convoreal_favorites";
const LEGACY_KEY = "crm_favorites";

export interface FavoriteItem {
  label: string;
  href: string;
  icon: string;
}

export function readFavorites(): FavoriteItem[] {
  if (typeof window === "undefined") return [];

  let raw = localStorage.getItem(KEY);
  if (raw === null) {
    raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return [];
    localStorage.setItem(KEY, raw);
    localStorage.removeItem(LEGACY_KEY);
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to parse favorites", err);
    return [];
  }
}

export function writeFavorites(favorites: FavoriteItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(favorites));
}
