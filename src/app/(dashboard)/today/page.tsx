"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TodayRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=today");
  }, [router]);
  return null;
}
