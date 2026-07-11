"use client"

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AgentsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/contacts?tab=agents");
  }, [router]);
  return null;
}
