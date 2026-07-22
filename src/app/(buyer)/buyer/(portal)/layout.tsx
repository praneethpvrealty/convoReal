import type { Metadata } from "next";

import { BuyerProvider } from "@/components/buyer/buyer-provider";
import { BuyerShell } from "@/components/buyer/buyer-shell";

export const metadata: Metadata = {
  title: "My Properties",
  description: "Your saved properties, preferences and alerts",
};

export default function BuyerPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <BuyerProvider>
      <BuyerShell>{children}</BuyerShell>
    </BuyerProvider>
  );
}
