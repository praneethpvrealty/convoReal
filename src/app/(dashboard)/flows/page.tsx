"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FlowsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/automations?tab=flows");
  }, [router]);
  return null;
}
