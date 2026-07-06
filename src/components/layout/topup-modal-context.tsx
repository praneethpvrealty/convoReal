"use client";

// ============================================================
// Shared "buy credits" modal state — the header chip's "+ Buy
// Credits" button and the sidebar widget's "+ Top Up" button both
// open the same modal instance instead of each mounting their own
// copy (avoids duplicate /api/billing/credits/packages fetches).
//
// The actual modal content (package grid, Razorpay/Stripe checkout)
// is rendered by CreditTopup.tsx — this context only tracks
// open/closed state so components across the layout can trigger it.
// ============================================================

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface TopupModalContextValue {
  isOpen: boolean;
  openTopupModal: () => void;
  closeTopupModal: () => void;
}

const TopupModalContext = createContext<TopupModalContextValue | null>(null);

export function TopupModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const value = useMemo(
    () => ({
      isOpen,
      openTopupModal: () => setIsOpen(true),
      closeTopupModal: () => setIsOpen(false),
    }),
    [isOpen],
  );

  return <TopupModalContext.Provider value={value}>{children}</TopupModalContext.Provider>;
}

export function useTopupModal(): TopupModalContextValue {
  const ctx = useContext(TopupModalContext);
  if (!ctx) {
    throw new Error("useTopupModal must be used within a TopupModalProvider");
  }
  return ctx;
}
