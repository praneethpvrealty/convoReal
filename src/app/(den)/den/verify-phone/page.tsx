"use client";

// ============================================================
// /den/verify-phone — the mandatory WhatsApp gate for Google
// sign-ins. Uses Supabase's phone_change flow: updateUser({ phone })
// sends an OTP through the existing WhatsApp Send-SMS hook, then
// verifyOtp(type 'phone_change') confirms it. The Den provider
// redirects here whenever a session has no verified phone; no Den
// page or API works until this completes.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Phone, ShieldCheck, ArrowLeft } from "lucide-react";

export default function DenVerifyPhonePage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      // Created lazily — module/body-level creation breaks static
      // prerendering of this page (no env vars at build time).
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/den/login");
        return;
      }
      // Already verified (e.g. OTP login landed here by accident) —
      // straight into the Den.
      if (user.phone && user.phone_confirmed_at) {
        router.replace("/den");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanPhone = (): string | null => {
    let p = phone.trim().replace(/\s+/g, "");
    if (!p.startsWith("+")) {
      if (p.replace(/\D/g, "").length === 10) p = `+91${p.replace(/\D/g, "")}`;
      else return null;
    }
    return p;
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    const p = cleanPhone();
    if (!p) {
      setError("Enter a valid WhatsApp number (e.g. 9900277111 or +919900277111)");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ phone: p });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setInfo("Code sent to your WhatsApp!");
    setOtpSent(true);
    setLoading(false);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = cleanPhone();
    if (!p) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone: p,
      token: otp.trim(),
      type: "phone_change",
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Finish Den identity + contact linking, then enter.
    await fetch("/api/den/auth/complete", { method: "POST" }).catch(() => null);
    window.location.href = "/den";
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="pointer-events-none absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <Card className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 p-2 shadow-2xl backdrop-blur-xl">
        <CardHeader className="items-center pb-2 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight text-white">
            Verify your WhatsApp
          </CardTitle>
          <CardDescription className="font-medium text-slate-400">
            One last step — your WhatsApp number is how we find your properties and keep you updated.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-4 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">
              {info}
            </div>
          )}

          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="verify-phone" className="text-xs font-bold text-slate-300">
                  WhatsApp Number
                </Label>
                <div className="relative">
                  <Phone className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="verify-phone"
                    type="tel"
                    placeholder="e.g. +91 99002 77111"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="h-10 rounded-xl border-slate-800 bg-slate-950 pl-10 text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="mt-1 h-10 w-full rounded-xl bg-primary text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              >
                {loading ? "Sending code…" : "Send WhatsApp Code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="verify-otp" className="text-xs font-bold text-slate-300">
                    Verification Code
                  </Label>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false);
                      setInfo(null);
                      setError(null);
                      setOtp("");
                    }}
                    className="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    <ArrowLeft className="size-3" /> Change Number
                  </button>
                </div>
                <Input
                  id="verify-otp"
                  type="text"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  className="h-12 rounded-xl border-slate-800 bg-slate-950 text-center text-xl font-bold tracking-[0.4em] text-white placeholder:text-sm placeholder:font-medium placeholder:tracking-normal placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>
              <Button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="mt-1 h-10 w-full rounded-xl bg-primary text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & Enter the Den"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
