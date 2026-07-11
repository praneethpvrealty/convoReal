"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RequirementsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/contacts?tab=requirements");
  }, [router]);
  return null;
}
