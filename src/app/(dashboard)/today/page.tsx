"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TodayRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    // Today became the Focus tab — its agenda is Focus's Tasks & visits
    // card and its remaining signals render underneath.
    router.replace("/dashboard?tab=focus");
  }, [router]);
  return null;
}
