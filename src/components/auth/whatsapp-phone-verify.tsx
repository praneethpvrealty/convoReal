"use client";

// ============================================================
// WhatsApp phone verification — shared OTP widget.
//
// Enter number → supabase.auth.updateUser({ phone }) sends a code on
// WhatsApp (phone_change OTP through the existing Send-SMS hook) →
// verifyOtp confirms it. On success the verified phone lives on
// auth.users, and the DB trigger (migration 136) mirrors it onto
// profiles.phone — nothing else to persist. Verification is per
// ACCOUNT: once done, no sign-in method (Google, email, OTP) ever
// asks again.
//
// Used by /verify-phone (staff gate) and the settings "Change number"
// dialog. Supabase client is created lazily inside handlers — module/
// body-level creation breaks static prerendering.
// ============================================================

import { useState } from "react";
import { Phone, ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function cleanPhoneInput(raw: string): string | null {
  let phone = raw.trim().replace(/\s+/g, "");
  if (!phone.startsWith("+")) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) phone = `+91${digits}`;
    else return null;
  }
  return phone;
}

export function WhatsappPhoneVerify({
  onVerified,
  initialPhone,
  idPrefix = "wa-verify",
}: {
  /** Called with the verified E.164 phone after a successful OTP. */
  onVerified: (phone: string) => void;
  initialPhone?: string;
  /** Keeps input ids unique when two instances could mount. */
  idPrefix?: string;
}) {
  const [phone, setPhone] = useState(initialPhone || "");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ phone: cleanPhone });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setInfo("Code sent to your WhatsApp!");
    setOtpSent(true);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: otp.trim(),
      type: "phone_change",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    onVerified(cleanPhone);
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-500">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-600">
          {info}
        </div>
      )}

      {!otpSent ? (
        <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-phone`} className="text-xs font-bold">
              WhatsApp Number
            </Label>
            <div className="relative">
              <Phone className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={`${idPrefix}-phone`}
                type="tel"
                placeholder="e.g. +91 99002 77111"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="h-10 rounded-xl pl-10"
              />
            </div>
            <p className="text-[11px] font-medium text-muted-foreground">
              We&apos;ll send a one-time code to this number on WhatsApp.
            </p>
          </div>
          <Button type="submit" disabled={loading} className="h-10 w-full rounded-xl text-xs font-bold">
            {loading ? "Sending code…" : "Send WhatsApp Code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor={`${idPrefix}-otp`} className="text-xs font-bold">
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
              id={`${idPrefix}-otp`}
              type="text"
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              placeholder="6-digit code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              className="h-12 rounded-xl text-center text-xl font-bold tracking-[0.4em] placeholder:text-sm placeholder:font-medium placeholder:tracking-normal"
            />
          </div>
          <Button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="h-10 w-full rounded-xl text-xs font-bold"
          >
            {loading ? "Verifying…" : "Verify Number"}
          </Button>
        </form>
      )}
    </div>
  );
}
