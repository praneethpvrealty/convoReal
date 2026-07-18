"use client"

import LiaisonsContent from "./liaisons-content";
import { FavoriteButton } from "@/components/layout/favorite-button";

export default function LiaisonsPage() {
  return (
    <div className="space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Liaisons
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            The people who get government work done — khata, EC, registration — with their fees and charges.
          </p>
        </div>
        <FavoriteButton label="Liaisons" href="/liaisons" icon="Landmark" />
      </div>

      <div className="relative z-10">
        <LiaisonsContent />
      </div>
    </div>
  );
}
