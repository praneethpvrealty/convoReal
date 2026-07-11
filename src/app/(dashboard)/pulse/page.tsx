"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PulseRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=pulse");
  }, [router]);
  return null;
}
