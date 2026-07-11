"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RadarRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=radar");
  }, [router]);
  return null;
}
