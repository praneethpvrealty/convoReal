"use client";

// ============================================================
// /verify-phone — the staff WhatsApp gate.
//
// Every ConvoReal account needs an OTP-verified WhatsApp number: the
// platform's enquiries, alerts and listing sync all run on WhatsApp.
// The dashboard shell redirects here when the signed-in user has no
// verified phone (fresh email/Google signup, or an existing account
// from before this rule). Verification happens ONCE per account —
// signing in with Google later never asks again, because the check is
// auth.users.phone_confirmed_at, not the sign-in method.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { WhatsappPhoneVerify } from "@/components/auth/whatsapp-phone-verify";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function VerifyPhonePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.phone && user.phone_confirmed_at) {
        // Already verified (e.g. WhatsApp-OTP login) — nothing to do.
        router.replace("/dashboard");
        return;
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="pointer-events-none absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <Card className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 p-2 shadow-2xl backdrop-blur-xl">
        <CardHeader className="items-center pb-2 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight text-white">
            Verify your WhatsApp number
          </CardTitle>
          <CardDescription className="font-medium text-slate-400">
            ConvoReal runs on WhatsApp — client enquiries, alerts and listing sync all reach you
            there. Verify the WhatsApp number you use for business to continue. You&apos;ll only do
            this once.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {ready ? (
            <WhatsappPhoneVerify
              idPrefix="staff-verify"
              onVerified={() => {
                // The DB trigger has already mirrored the verified
                // number onto profiles.phone; hard navigation so the
                // shell re-reads a fresh session.
                window.location.href = "/dashboard";
              }}
            />
          ) : (
            <p className="py-6 text-center text-sm font-medium text-slate-400">Loading…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
