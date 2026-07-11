"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PipelinesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/automations?tab=pipelines");
  }, [router]);
  return null;
}
