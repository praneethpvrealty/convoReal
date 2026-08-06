"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import {
  readFavorites,
  writeFavorites,
  type FavoriteItem,
} from "@/lib/favorites-storage";

interface FavoriteButtonProps {
  label: string;
  href: string;
  icon: string;
}

export function FavoriteButton({ label, href, icon }: FavoriteButtonProps) {
  const [isFavorite, setIsFavorite] = useState(() =>
    readFavorites().some((item) => item.href === href),
  );

  useEffect(() => {
    Promise.resolve().then(() => {
      setIsFavorite(readFavorites().some((item) => item.href === href));
    });
  }, [href]);

  const toggleFavorite = () => {
    let favorites: FavoriteItem[] = readFavorites();

    if (isFavorite) {
      // Remove from favorites
      favorites = favorites.filter((item) => item.href !== href);
      setIsFavorite(false);
      toast.success(`Removed "${label}" from Favourites`);
    } else {
      // Add to favorites
      favorites.push({ label, href, icon });
      setIsFavorite(true);
      toast.success(`Added "${label}" to Favourites`);
    }

    writeFavorites(favorites);
    // Dispatch custom event to notify Sidebar / FavoritesCard
    window.dispatchEvent(new Event("favorites-changed"));
  };

  return (
    <button
      onClick={toggleFavorite}
      title={isFavorite ? "Remove from Favourites" : "Add to Favourites"}
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
