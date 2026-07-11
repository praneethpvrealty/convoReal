"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

interface FavoriteItem {
  label: string;
  href: string;
  icon: string;
}

interface FavoriteButtonProps {
  label: string;
  href: string;
  icon: string;
}

export function FavoriteButton({ label, href, icon }: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("crm_favorites");
    if (!stored) return false;
    try {
      const favorites: FavoriteItem[] = JSON.parse(stored);
      return favorites.some((item) => item.href === href);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    Promise.resolve().then(() => {
      const stored = localStorage.getItem("crm_favorites");
      if (stored) {
        try {
          const favorites: FavoriteItem[] = JSON.parse(stored);
          setIsFavorite(favorites.some((item) => item.href === href));
        } catch (err) {
          console.error("Failed to parse favorites", err);
        }
      } else {
        setIsFavorite(false);
      }
    });
  }, [href]);

  const toggleFavorite = () => {
    const stored = localStorage.getItem("crm_favorites");
    let favorites: FavoriteItem[] = [];
    if (stored) {
      try {
        favorites = JSON.parse(stored);
      } catch (err) {
        console.error("Failed to parse favorites", err);
      }
    }

    if (isFavorite) {
      // Remove from favorites
      favorites = favorites.filter((item) => item.href !== href);
      setIsFavorite(false);
      toast.success(`Removed "${label}" from Favorites`);
    } else {
      // Add to favorites
      favorites.push({ label, href, icon });
      setIsFavorite(true);
      toast.success(`Added "${label}" to Favorites`);
    }

    localStorage.setItem("crm_favorites", JSON.stringify(favorites));
    // Dispatch custom event to notify Sidebar / FavoritesCard
    window.dispatchEvent(new Event("favorites-changed"));
  };

  return (
    <button
      onClick={toggleFavorite}
      title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
      className="flex items-center justify-center h-8 w-8 rounded-md bg-slate-900/60 border border-slate-800/80 cursor-pointer focus:outline-none transition-all active:scale-95"
    >
      <Star
        className={`h-4.5 w-4.5 transition-all duration-200 ${
          isFavorite
            ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)] scale-110"
            : "text-slate-400 hover:text-slate-200"
        }`}
      />
    </button>
  );
}
