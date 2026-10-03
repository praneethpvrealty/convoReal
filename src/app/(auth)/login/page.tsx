'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { toAuthPhone } from '@/lib/whatsapp/phone-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MessageSquare, UsersRound, Phone, ArrowLeft } from 'lucide-react';
import { reloadTo } from '@/lib/navigation';

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
  const inviteToken = searchParams.get('invite');

  const [activeTab, setActiveTab] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpValues, setOtpValues] = useState<string[]>(Array(6).fill(''));
  const otp = otpValues.join('');
  const [otpSent, setOtpSent] = useState(false);

  const handleOtpChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, '');
    const nextOtp = [...otpValues];
    nextOtp[index] = digit.slice(-1);
    setOtpValues(nextOtp);

    // Auto-focus next box if a digit was typed
    if (digit && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }

    // Auto-submit if all 6 digits are entered
    const finalOtp = nextOtp.join('');
    if (finalOtp.length === 6) {
      setTimeout(() => {
        const form = document.getElementById('otp-form') as HTMLFormElement;
        form?.requestSubmit();
      }, 50);
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Backspace') {
      if (!otpValues[index] && index > 0) {
        // Clear previous box and focus it
        const nextOtp = [...otpValues];
        nextOtp[index - 1] = '';
        setOtpValues(nextOtp);
        const prevInput = document.getElementById(`otp-${index - 1}`);
        prevInput?.focus();
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (pasteData.length > 0) {
      const newOtp = [...otpValues];
      pasteData.split('').forEach((digit, idx) => {
        if (idx < 6) newOtp[idx] = digit;
      });
      setOtpValues(newOtp);
      // Focus the last filled box or the next empty box
      const targetIndex = Math.min(pasteData.length, 5);
      const nextInput = document.getElementById(`otp-${targetIndex}`);
      nextInput?.focus();
    }
  };
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (otpSent) {
      setTimeout(() => {
        const firstInput = document.getElementById('otp-0');
        firstInput?.focus();
      }, 80);
    }
  }, [otpSent]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    console.log('[LOGIN] Attempting signInWithPassword for:', email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log(
      '[LOGIN] Result → error:',
      error,
      '| session:',
      data?.session?.access_token ? 'present' : 'null'
    );

    if (error) {
      console.error('[LOGIN] Auth error:', error.message, error.status);
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      console.error(
        '[LOGIN] No session returned despite no error — email may not be confirmed'
      );
      setError(
        'Login failed: no session returned. Your email may not be confirmed — check your inbox.'
      );
      setLoading(false);
      return;
    }

    console.log('[LOGIN] Session OK, navigating via window.location...');
    // Use window.location.href (hard navigation) to avoid Next.js middleware
    // cookie timing race — the browser will send all fresh cookies on a real
    // HTTP request rather than a client-side push which can race with
    // the cookie being committed.
    if (inviteToken) {
      reloadTo(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      reloadTo('/dashboard');
    }
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    const cleanPhone = toAuthPhone(phone);
    if (!cleanPhone) {
      setError(
        'Please enter a valid phone number (e.g. 9900277111 or +919900277111)'
      );
      setLoading(false);
      return;
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
      setSuccessMessage('Verification code sent to your WhatsApp!');
      setOtpSent(true);
      setLoading(false);
      setCountdown(60);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Must resolve to the same string handleSendOtp sent, or Supabase
    // looks up a different identity than the code was issued for.
    const cleanPhone = toAuthPhone(phone);
    if (!cleanPhone) {
      setError(
        'Please enter a valid phone number (e.g. 9900277111 or +919900277111)'
      );
      setLoading(false);
      return;
    }

    console.log('[LOGIN] Verifying OTP code for:', cleanPhone);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: otp.trim(),
      type: 'sms',
    });

    if (error) {
      console.error('[LOGIN] OTP verification error:', error.message);
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      setError('Session establishment failed. Please try again.');
      setLoading(false);
      return;
    }

    console.log('[LOGIN] OTP Session established, navigating...');
    if (inviteToken) {
      reloadTo(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      reloadTo('/dashboard');
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback${
      inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''
    }`;
    console.log(
      '[LOGIN] Attempting signInWithOAuth for Google, redirecting to:',
      redirectTo
    );
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      {/* Ambient radial glows */}
      <div className="bg-primary/10 pointer-events-none absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]" />
      <div className="pointer-events-none absolute right-1/4 bottom-1/4 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 rounded-full bg-indigo-500/10 blur-[100px]" />

      {/* Grid background pattern */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] bg-[size:4rem_4rem] opacity-50" />

      <Card className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 p-2 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/50">
        <CardHeader className="items-center pb-2 text-center">
          <div className="bg-primary/10 border-primary/20 mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border shadow-inner">
            {inviteToken ? (
              <UsersRound className="text-primary h-6 w-6" />
            ) : (
              <MessageSquare className="text-primary h-6 w-6" />
            )}
          </div>
          <CardTitle className="text-2xl font-black tracking-tight text-white">
            {inviteToken ? 'Sign in to accept' : 'Welcome back'}
          </CardTitle>
          <CardDescription className="font-medium text-slate-400">
            {inviteToken
              ? "Sign in and we'll take you to the invitation."
              : 'Sign in to your account'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Tab Selection */}
          <div className="border-slate-850 mb-6 flex rounded-xl border bg-slate-950/70 p-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('email');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 cursor-pointer rounded-lg py-2 text-xs font-bold transition-all ${
                activeTab === 'email'
                  ? 'bg-primary shadow-primary/20 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Email Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('phone');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`flex-1 cursor-pointer rounded-lg py-2 text-xs font-bold transition-all ${
                activeTab === 'phone'
                  ? 'bg-primary shadow-primary/20 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              WhatsApp OTP
            </button>
          </div>

          {/* Status alerts */}
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="mb-4 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-400">
              {successMessage}
            </div>
          )}

          {activeTab === 'email' ? (
            /* Email Password Form */
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="email"
                  className="text-xs font-bold text-slate-300"
                >
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl border-slate-800 bg-slate-950 text-white placeholder:text-slate-600"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="password"
                    className="text-xs font-bold text-slate-300"
                  >
                    Password
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-primary hover:text-primary/80 text-xs font-bold"
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
                  className="focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl border-slate-800 bg-slate-950 text-white placeholder:text-slate-600"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="bg-primary hover:bg-primary-hover hover:shadow-primary/20 mt-2 h-10 w-full cursor-pointer rounded-xl text-xs font-bold text-white transition-all hover:scale-101 hover:shadow-lg active:scale-99 disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          ) : (
            /* WhatsApp / Phone OTP Form */
            <div className="flex flex-col gap-4">
              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor="phone"
                      className="text-xs font-bold text-slate-300"
                    >
                      Phone Number
                    </Label>
                    <div className="relative">
                      <Phone className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="e.g. +91 99002 77111"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        className="focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl border-slate-800 bg-slate-950 pl-10 text-white placeholder:text-slate-600"
                      />
                    </div>
                    <p className="text-[10px] font-medium text-slate-500">
                      Enter with country code (e.g. +91 for India).
                    </p>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="bg-primary hover:bg-primary-hover hover:shadow-primary/20 mt-2 h-10 w-full cursor-pointer rounded-xl text-xs font-bold text-white transition-all hover:scale-101 hover:shadow-lg active:scale-99 disabled:opacity-50"
                  >
                    {loading ? 'Sending code...' : 'Send Verification Code'}
                  </Button>
                </form>
              ) : (
                <form
                  id="otp-form"
                  onSubmit={handleVerifyOtp}
                  className="flex flex-col gap-4"
                >
                  <div className="flex flex-col gap-2">
                    <div className="mb-1 flex items-center justify-between">
                      <Label className="text-xs font-bold text-slate-300">
                        Verification Code
                      </Label>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpSent(false);
                          setSuccessMessage(null);
                          setError(null);
                          setOtpValues(Array(6).fill(''));
                        }}
                        className="text-primary flex cursor-pointer items-center gap-1 text-[11px] font-bold hover:underline"
                      >
                        <ArrowLeft className="size-3" /> Change Number
                      </button>
                    </div>
                    <div className="flex justify-between gap-2">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <input
                          key={idx}
                          id={`otp-${idx}`}
                          type="text"
                          pattern="\d*"
                          inputMode="numeric"
                          maxLength={1}
                          value={otpValues[idx]}
                          onChange={(e) => handleOtpChange(idx, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          onPaste={idx === 0 ? handleOtpPaste : undefined}
                          className="border-slate-850 focus:border-primary focus:ring-primary/30 animate-fade-in h-12 w-12 rounded-xl border bg-slate-950 text-center text-xl font-bold text-white transition-all outline-none focus:ring-1"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-1 text-xs font-semibold">
                    <span className="text-slate-500">
                      Didn&apos;t receive the code?
                    </span>
                    {countdown > 0 ? (
                      <span className="font-mono text-slate-400">
                        Resend in {countdown}s
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendOtp()}
                        className="text-primary cursor-pointer border-0 bg-transparent p-0 font-bold hover:underline"
                      >
                        Resend code
                      </button>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="bg-primary hover:bg-primary-hover hover:shadow-primary/20 mt-2 h-10 w-full cursor-pointer rounded-xl text-xs font-bold text-white transition-all hover:scale-101 hover:shadow-lg active:scale-99 disabled:opacity-50"
                  >
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
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
              <span className="bg-slate-900/40 px-2 font-bold text-slate-500 backdrop-blur-xl">
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
            className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 text-xs font-bold text-slate-200 transition-all hover:border-slate-700/80 hover:bg-slate-900 hover:text-white active:scale-99 disabled:opacity-50"
          >
            <svg
              className="mr-1 h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g transform="matrix(1, 0, 0, 1, 0, 0)">
                <path
                  d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.6h3.29c1.92,-1.78 3.02,-4.4 3.02,-7.4C21.65,11.83 21.54,11.43 21.35,11.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12,20.5c2.3,0 4.23,-0.76 5.64,-2.08l-3.29,-2.6c-0.91,0.61 -2.07,0.98 -3.29,0.98 -2.25,0 -4.16,-1.52 -4.84,-3.57H2.88v2.7C4.29,18.73 7.89,20.5 12,20.5z"
                  fill="#34A853"
                />
                <path
                  d="M7.16,13.23c-0.17,-0.52 -0.27,-1.07 -0.27,-1.64c0,-0.57 0.1,-1.12 0.27,-1.64V7.25H2.88C2.3,8.42 2,9.78 2,11.5c0,1.72 0.3,3.08 0.88,4.25l4.28,-3.27z"
                  fill="#FBBC05"
                />
                <path
                  d="M12,5.2c1.25,0 2.37,0.43 3.25,1.28l2.44,-2.44C16.22,2.63 14.29,1.7 12,1.7c-4.11,0 -7.71,1.77 -9.12,4.55l4.28,3.27C7.84,6.72 9.75,5.2 12,5.2z"
                  fill="#EA4335"
                />
              </g>
            </svg>
            Sign in with Google
          </Button>

          <p className="mt-6 text-center text-sm font-medium text-slate-400">
            Don&apos;t have an account?{' '}
            <Link
              href={
                inviteToken
                  ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                  : '/signup'
              }
              className="text-primary hover:text-primary/80 font-bold transition-all"
            >
              Create account
            </Link>
          </p>

          {/* Property owners get their own portal — the Owners Den. */}
          <Link
            href="/den/login"
            className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 transition-colors hover:bg-amber-500/10"
          >
            <span className="text-xs font-bold text-amber-400">
              Own a property? List &amp; manage it in your Portfolio
            </span>
            <span className="shrink-0 text-xs font-black text-amber-400">
              →
            </span>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
