import type { Metadata } from "next";

import { DenProvider } from "@/components/den/den-provider";
import { DenShell } from "@/components/den/den-shell";

export const metadata: Metadata = {
  title: "Owners Den",
  description: "Your exclusive property owner portal",
};

export default function DenPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <DenProvider>
      <DenShell>{children}</DenShell>
    </DenProvider>
  );
}
