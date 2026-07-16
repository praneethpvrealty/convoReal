"use client";

// ============================================================
// /den/login — Owners Den sign-in. Phone-first (WhatsApp OTP via the
// existing Supabase Send-SMS hook), Google secondary. Google users
// are routed through /den/verify-phone — a WhatsApp number is
// mandatory for every Den account.
// ============================================================

import { useEffect, useState } from "react";

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
import { KeyRound, Phone, ArrowLeft } from "lucide-react";

function cleanPhoneInput(raw: string): string | null {
  let phone = raw.trim().replace(/\s+/g, "");
  if (!phone.startsWith("+")) {
    if (phone.replace(/\D/g, "").length === 10) phone = `+91${phone.replace(/\D/g, "")}`;
    else return null;
  }
  return phone;
}

export default function DenLoginPage() {
  const [phone, setPhone] = useState("");
  const [otpValues, setOtpValues] = useState<string[]>(Array(6).fill(""));
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (otpSent) {
      setTimeout(() => document.getElementById("den-otp-0")?.focus(), 80);
    }
  }, [otpSent]);

  const handleOtpChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, "");
    const next = [...otpValues];
    next[index] = digit.slice(-1);
    setOtpValues(next);
    if (digit && index < 5) document.getElementById(`den-otp-${index + 1}`)?.focus();
    if (next.join("").length === 6) {
      setTimeout(() => {
        (document.getElementById("den-otp-form") as HTMLFormElement | null)?.requestSubmit();
      }, 50);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      const next = [...otpValues];
      next[index - 1] = "";
      setOtpValues(next);
      document.getElementById(`den-otp-${index - 1}`)?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = [...otpValues];
    pasted.split("").forEach((d, i) => {
      if (i < 6) next[i] = d;
    });
    setOtpValues(next);
    document.getElementById(`den-otp-${Math.min(pasted.length, 5)}`)?.focus();
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setInfo(null);
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) {
      setError("Enter a valid WhatsApp number (e.g. 9900277111 or +919900277111)");
      return;
    }
    setLoading(true);
    // app_context 'den' keeps first-time Den signups out of the staff
    // account bootstrap (handle_new_user guard, migration 131).
    const { error } = await supabase.auth.signInWithOtp({
      phone: cleanPhone,
      options: { data: { app_context: "den" } },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setInfo("Code sent to your WhatsApp!");
    setOtpSent(true);
    setLoading(false);
    setCountdown(60);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) return;
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: otpValues.join("").trim(),
      type: "sms",
    });
    if (error || !data.session) {
      setError(error?.message || "Could not verify the code. Please try again.");
      setLoading(false);
      return;
    }
    // Hard navigation so fresh cookies ride the next request; the Den
    // provider finishes linking via /api/den/auth/complete.
    window.location.href = "/den";
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/den/verify-phone")}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="pointer-events-none absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute right-1/4 bottom-1/4 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 rounded-full bg-amber-500/10 blur-[100px]" />

      <Card className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 p-2 shadow-2xl backdrop-blur-xl">
        <CardHeader className="items-center pb-2 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight text-white">Owners Den</CardTitle>
          <CardDescription className="font-medium text-slate-400">
            Your private space to manage your properties, track buyer interest and sell on your terms.
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
                <Label htmlFor="den-phone" className="text-xs font-bold text-slate-300">
                  WhatsApp Number
                </Label>
                <div className="relative">
                  <Phone className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="den-phone"
                    type="tel"
                    placeholder="e.g. +91 99002 77111"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="h-10 rounded-xl border-slate-800 bg-slate-950 pl-10 text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20"
                  />
                </div>
                <p className="text-[10px] font-medium text-slate-500">
                  We&apos;ll send a one-time code to this number on WhatsApp.
                </p>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="mt-1 h-10 w-full rounded-xl bg-primary text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              >
                {loading ? "Sending code…" : "Continue with WhatsApp"}
              </Button>
            </form>
          ) : (
            <form id="den-otp-form" onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-300">Verification Code</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false);
                      setInfo(null);
                      setError(null);
                      setOtpValues(Array(6).fill(""));
                    }}
                    className="flex cursor-pointer items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    <ArrowLeft className="size-3" /> Change Number
                  </button>
                </div>
                <div className="flex justify-between gap-2">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <input
                      key={idx}
                      id={`den-otp-${idx}`}
                      type="text"
                      pattern="\d*"
                      inputMode="numeric"
                      maxLength={1}
                      value={otpValues[idx]}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onPaste={idx === 0 ? handleOtpPaste : undefined}
                      className="h-12 w-12 rounded-xl border border-slate-800 bg-slate-950 text-center text-xl font-bold text-white outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary/30"
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between px-1 text-xs font-semibold">
                <span className="text-slate-500">Didn&apos;t receive the code?</span>
                {countdown > 0 ? (
                  <span className="font-mono text-slate-400">Resend in {countdown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendOtp()}
                    className="cursor-pointer border-0 bg-transparent p-0 font-bold text-primary hover:underline"
                  >
                    Resend code
                  </button>
                )}
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="mt-1 h-10 w-full rounded-xl bg-primary text-xs font-bold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & Enter the Den"}
              </Button>
            </form>
          )}

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900/40 px-2 font-bold text-slate-500 backdrop-blur-xl">
                or continue with
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={handleGoogleLogin}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 text-xs font-bold text-slate-200 transition-all hover:bg-slate-900 hover:text-white disabled:opacity-50"
          >
            <svg className="mr-1 h-4 w-4 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.6h3.29c1.92,-1.78 3.02,-4.4 3.02,-7.4C21.65,11.83 21.54,11.43 21.35,11.1z" fill="#4285F4" />
              <path d="M12,20.5c2.3,0 4.23,-0.76 5.64,-2.08l-3.29,-2.6c-0.91,0.61 -2.07,0.98 -3.29,0.98 -2.25,0 -4.16,-1.52 -4.84,-3.57H2.88v2.7C4.29,18.73 7.89,20.5 12,20.5z" fill="#34A853" />
              <path d="M7.16,13.23c-0.17,-0.52 -0.27,-1.07 -0.27,-1.64c0,-0.57 0.1,-1.12 0.27,-1.64V7.25H2.88C2.3,8.42 2,9.78 2,11.5c0,1.72 0.3,3.08 0.88,4.25l4.28,-3.27z" fill="#FBBC05" />
              <path d="M12,5.2c1.25,0 2.37,0.43 3.25,1.28l2.44,-2.44C16.22,2.63 14.29,1.7 12,1.7c-4.11,0 -7.71,1.77 -9.12,4.55l4.28,3.27C7.84,6.72 9.75,5.2 12,5.2z" fill="#EA4335" />
            </svg>
            Continue with Google
          </Button>
          <p className="mt-3 text-center text-[10px] font-medium text-slate-500">
            Google sign-ins verify a WhatsApp number next — it&apos;s how we match you to your properties.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
