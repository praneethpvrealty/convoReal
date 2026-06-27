"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
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
import { MessageSquare, UsersRound, Phone, Key, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");

  const [activeTab, setActiveTab] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    console.log('[LOGIN] Attempting signInWithPassword for:', email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log('[LOGIN] Result → error:', error, '| session:', data?.session?.access_token ? 'present' : 'null');

    if (error) {
      console.error('[LOGIN] Auth error:', error.message, error.status);
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      console.error('[LOGIN] No session returned despite no error — email may not be confirmed');
      setError('Login failed: no session returned. Your email may not be confirmed — check your inbox.');
      setLoading(false);
      return;
    }

    console.log('[LOGIN] Session OK, navigating via window.location...');
    // Use window.location.href (hard navigation) to avoid Next.js middleware
    // cookie timing race — the browser will send all fresh cookies on a real
    // HTTP request rather than a client-side push which can race with
    // the cookie being committed.
    if (inviteToken) {
      window.location.href = `/join/${encodeURIComponent(inviteToken)}`;
    } else {
      window.location.href = '/dashboard';
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    let cleanPhone = phone.trim().replace(/\s+/g, "");
    if (!cleanPhone.startsWith("+")) {
      if (cleanPhone.length === 10) {
        cleanPhone = `+91${cleanPhone}`;
      } else {
        setError("Please enter a valid phone number (e.g. 9900277111 or +919900277111)");
        setLoading(false);
        return;
      }
    }

    console.log('[LOGIN] Requesting SMS OTP for phone:', cleanPhone);
    const { error } = await supabase.auth.signInWithOtp({
      phone: cleanPhone,
    });

    if (error) {
      console.error('[LOGIN] SMS OTP request error:', error.message);
      setError(error.message);
      setLoading(false);
    } else {
      setSuccessMessage("Verification code sent to your WhatsApp!");
      setOtpSent(true);
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let cleanPhone = phone.trim().replace(/\s+/g, "");
    if (!cleanPhone.startsWith("+") && cleanPhone.length === 10) {
      cleanPhone = `+91${cleanPhone}`;
    }

    console.log('[LOGIN] Verifying OTP code for:', cleanPhone);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: otp.trim(),
      type: "sms",
    });

    if (error) {
      console.error('[LOGIN] OTP verification error:', error.message);
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      setError("Session establishment failed. Please try again.");
      setLoading(false);
      return;
    }

    console.log('[LOGIN] OTP Session established, navigating...');
    if (inviteToken) {
      window.location.href = `/join/${encodeURIComponent(inviteToken)}`;
    } else {
      window.location.href = '/dashboard';
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback${
      inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""
    }`;
    console.log('[LOGIN] Attempting signInWithOAuth for Google, redirecting to:', redirectTo);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      console.error('[LOGIN] OAuth error:', error.message);
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 overflow-hidden">
      {/* Ambient radial glows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
      
      {/* Grid background pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50 pointer-events-none" />

      <Card className="relative w-full max-w-md border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl shadow-2xl hover:border-slate-700/50 transition-all duration-300 rounded-3xl overflow-hidden z-10 p-2">
        <CardHeader className="items-center text-center pb-2">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 shadow-inner">
            {inviteToken ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <MessageSquare className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-black text-white tracking-tight">
            {inviteToken ? "Sign in to accept" : "Welcome back"}
          </CardTitle>
          <CardDescription className="text-slate-400 font-medium">
            {inviteToken
              ? "Sign in and we'll take you to the invitation."
              : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          
          {/* Tab Selection */}
          <div className="flex bg-slate-950/70 p-1 rounded-xl border border-slate-850 mb-6">
            <button
              type="button"
              onClick={() => { setActiveTab('email'); setError(null); setSuccessMessage(null); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'email'
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Email Sign In
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('phone'); setError(null); setSuccessMessage(null); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'phone'
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              WhatsApp OTP
            </button>
          </div>

          {/* Status alerts */}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 font-medium mb-4">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400 font-medium mb-4">
              {successMessage}
            </div>
          )}

          {activeTab === 'email' ? (
            /* Email Password Form */
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-slate-300 font-bold text-xs">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-slate-800 bg-slate-950 text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-300 font-bold text-xs">
                    Password
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-primary hover:text-primary/80 font-bold"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-slate-800 bg-slate-950 text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-2 h-10 w-full bg-primary hover:bg-primary-hover text-white text-xs font-bold rounded-xl cursor-pointer hover:scale-101 hover:shadow-lg hover:shadow-primary/20 active:scale-99 transition-all disabled:opacity-50"
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : (
            /* WhatsApp / Phone OTP Form */
            <div className="flex flex-col gap-4">
              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="phone" className="text-slate-300 font-bold text-xs">
                      Phone Number
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="e.g. +91 99002 77111"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        className="pl-10 border-slate-800 bg-slate-950 text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium">
                      Enter with country code (e.g. +91 for India).
                    </p>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="mt-2 h-10 w-full bg-primary hover:bg-primary-hover text-white text-xs font-bold rounded-xl cursor-pointer hover:scale-101 hover:shadow-lg hover:shadow-primary/20 active:scale-99 transition-all disabled:opacity-50"
                  >
                    {loading ? "Sending code..." : "Send Verification Code"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="otp" className="text-slate-300 font-bold text-xs">
                        Verification Code
                      </Label>
                      <button
                        type="button"
                        onClick={() => { setOtpSent(false); setSuccessMessage(null); setError(null); }}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline font-bold cursor-pointer"
                      >
                        <ArrowLeft className="size-3" /> Change Number
                      </button>
                    </div>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                      <Input
                        id="otp"
                        type="text"
                        placeholder="Enter 6-digit code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        required
                        maxLength={6}
                        className="pl-10 border-slate-800 bg-slate-950 text-white placeholder:text-slate-600 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl tracking-widest font-black text-center"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="mt-2 h-10 w-full bg-primary hover:bg-primary-hover text-white text-xs font-bold rounded-xl cursor-pointer hover:scale-101 hover:shadow-lg hover:shadow-primary/20 active:scale-99 transition-all disabled:opacity-50"
                  >
                    {loading ? "Verifying..." : "Verify & Sign In"}
                  </Button>
                </form>
              )}
            </div>
          )}

          {/* Social login divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900/40 backdrop-blur-xl px-2 text-slate-500 font-bold">
                or continue with
              </span>
            </div>
          </div>

          {/* Google Login Button */}
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={handleGoogleLogin}
            className="flex h-10 w-full items-center justify-center gap-2 border border-slate-800 bg-slate-950/80 text-slate-200 hover:bg-slate-900 hover:text-white disabled:opacity-50 hover:border-slate-700/80 transition-all rounded-xl font-bold text-xs cursor-pointer active:scale-99"
          >
            <svg className="h-4 w-4 mr-1 shrink-0" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
              <g transform="matrix(1, 0, 0, 1, 0, 0)">
                <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.6h3.29c1.92,-1.78 3.02,-4.4 3.02,-7.4C21.65,11.83 21.54,11.43 21.35,11.1z" fill="#4285F4" />
                <path d="M12,20.5c2.3,0 4.23,-0.76 5.64,-2.08l-3.29,-2.6c-0.91,0.61 -2.07,0.98 -3.29,0.98 -2.25,0 -4.16,-1.52 -4.84,-3.57H2.88v2.7C4.29,18.73 7.89,20.5 12,20.5z" fill="#34A853" />
                <path d="M7.16,13.23c-0.17,-0.52 -0.27,-1.07 -0.27,-1.64c0,-0.57 0.1,-1.12 0.27,-1.64V7.25H2.88C2.3,8.42 2,9.78 2,11.5c0,1.72 0.3,3.08 0.88,4.25l4.28,-3.27z" fill="#FBBC05" />
                <path d="M12,5.2c1.25,0 2.37,0.43 3.25,1.28l2.44,-2.44C16.22,2.63 14.29,1.7 12,1.7c-4.11,0 -7.71,1.77 -9.12,4.55l4.28,3.27C7.84,6.72 9.75,5.2 12,5.2z" fill="#EA4335" />
              </g>
            </svg>
            Sign in with Google
          </Button>

          <p className="mt-6 text-center text-sm text-slate-400 font-medium">
            Don&apos;t have an account?{" "}
            <Link
              href={
                inviteToken
                  ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                  : "/signup"
              }
              className="text-primary hover:text-primary/80 font-bold transition-all"
            >
              Create account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
