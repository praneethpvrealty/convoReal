'use client';

import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Star,
  LayoutDashboard,
  Sun,
  Radar,
  Activity,
  Users,
  ClipboardList,
  UsersRound,
  Home,
  Megaphone,
  Calendar,
  MessageSquare,
  GitBranch,
  Workflow,
  Radio,
  Settings,
  Landmark,
  Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readFavorites, type FavoriteItem } from '@/lib/favorites-storage';

const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard,
  Sun,
  Radar,
  Activity,
  Users,
  ClipboardList,
  UsersRound,
  Home,
  Megaphone,
  Calendar,
  MessageSquare,
  GitBranch,
  Workflow,
  Radio,
  Settings,
  Landmark,
  Briefcase,
};

export function FavoritesCard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [favorites, setFavorites] = useState<FavoriteItem[]>(readFavorites);
  const [startIndex, setStartIndex] = useState(0);
  const [, startTransition] = useTransition();

  // Re-build current full URL (with tab search params) to highlight the active favorite
  const currentFullPath =
    pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');

  const loadFavorites = () => {
    setFavorites(readFavorites());
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      loadFavorites();
    });

    const handleUpdate = () => {
      loadFavorites();
    };

    window.addEventListener('favorites-changed', handleUpdate);
    return () => {
      window.removeEventListener('favorites-changed', handleUpdate);
    };
  }, []);

  // Ensure index remains in bounds if items are added, deleted, or updated
  useEffect(() => {
    const maxIndex = Math.max(0, favorites.length - 2);
    if (startIndex > maxIndex) {
      Promise.resolve().then(() => {
        setStartIndex(maxIndex);
      });
    }
  }, [favorites.length, startIndex]);

  if (favorites.length === 0) {
    return (
      <div className="mx-3 my-2 rounded-xl border border-slate-900/60 bg-slate-950/20 p-3 backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
          <Star className="h-3.5 w-3.5 text-amber-500/80" />
          <span>Favourites</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
          Star pages to pin them here for 1-click access.
        </p>
      </div>
    );
  }

  const handleNext = () => {
    if (startIndex + 2 < favorites.length) {
      startTransition(() => {
        setStartIndex((prev) => prev + 1);
      });
    }
  };

  const handlePrev = () => {
    if (startIndex > 0) {
      startTransition(() => {
        setStartIndex((prev) => prev - 1);
      });
    }
  };

  const visibleItems = favorites.slice(startIndex, startIndex + 2);

  return (
    <div className="relative mx-3 my-2 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/20 p-3 backdrop-blur-md">
      {/* Glow highlight inside card */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full bg-amber-500/5 blur-xl" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.4)]" />
          <span>Favourites</span>
          <span className="rounded-full border border-slate-800/40 bg-slate-900/55 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
            {favorites.length}
          </span>
        </div>

        {/* Paginated Navigation Arrows */}
        {favorites.length > 2 && (
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              disabled={startIndex === 0}
              className={cn(
                'flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-slate-800/45 bg-slate-900/40 text-slate-400 transition-all hover:text-white disabled:pointer-events-none disabled:opacity-30'
              )}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              onClick={handleNext}
              disabled={startIndex + 2 >= favorites.length}
              className={cn(
                'flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-slate-800/45 bg-slate-900/40 text-slate-400 transition-all hover:text-white disabled:pointer-events-none disabled:opacity-30'
              )}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Items Slider List */}
      <div className="mt-2.5 flex flex-col gap-2">
        {visibleItems.map((item) => {
          const IconComponent = ICON_MAP[item.icon] || LayoutDashboard;
          const isActive =
            currentFullPath === item.href || pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-2.5 rounded-lg border p-2 text-xs transition-all duration-200',
                isActive
                  ? 'bg-primary/10 border-primary/40 text-primary font-bold shadow-[inset_0_1px_12px_rgba(var(--primary-rgb),0.08)]'
                  : 'border-slate-900 bg-slate-900/40 text-slate-400 hover:border-slate-800 hover:bg-slate-800/40 hover:text-slate-200'
              )}
            >
              <IconComponent
                className={cn(
                  'h-3.5 w-3.5 transition-all group-hover:scale-115',
                  isActive
                    ? 'text-primary'
                    : 'text-slate-400 group-hover:text-slate-200'
                )}
              />
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
