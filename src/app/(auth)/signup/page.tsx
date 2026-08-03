"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { MessageSquare, CheckCircle, UsersRound } from "lucide-react";
import { WaitlistForm } from "@/components/beta/waitlist-form";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query so it survives the signup → email
  // verification → redirect round-trip. `emailRedirectTo` below
  // points back at /join/<token> so the user lands on the redeem
  // step after verifying instead of being dropped on /dashboard.
  const inviteToken = searchParams.get("invite");
  // Referral code from a shared `?ref=CODE` link (see /join route
  // collision note — referral codes use `?ref=` on /signup rather
  // than reusing the /join/[token] path, which is team-invite only).
  // Captured onto accounts.referred_by_code by handle_new_user()
  // (migration 088); a reconciliation cron later turns this into a
  // `referrals` row via processReferralSignup(), since there's no
  // active session yet to call an authed API route from here.
  const referredByCode = searchParams.get("ref");
  // Beta invite token from /i/<token> → "Claim my seat". Distinct
  // from `invite` above, which is a TEAM invite: that one adds you to
  // someone's existing account, this one authorizes creating your own.
  // Both are passed to signUp() as metadata and validated by
  // handle_new_user() (migration 189) — the UI check below is a
  // courtesy, the trigger is the actual gate.
  const betaToken = searchParams.get("beta");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Escape hatch for the one legitimate no-token signup: a user whose
  // phone already matches an existing profile (migration 067). The
  // trigger lets them through, so the UI must not hard-block them.
  const [bypassGate, setBypassGate] = useState(false);
  const supabase = createClient();


  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    // If we have an invite token, point Supabase's verification
    // email back at the join page so the user can accept after
    // verifying. Without a token, Supabase uses its default
    // redirect (the app root).
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`
      : betaToken
        ? `${window.location.origin}/login`
        : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(referredByCode ? { referred_by_code: referredByCode } : {}),
          ...(betaToken ? { beta_invite: betaToken } : {}),
          ...(inviteToken ? { team_invite: inviteToken } : {}),
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  // Invite-only notice. NOT the gate — handle_new_user() is
  // (migration 189), because signUp() is a public endpoint callable
  // with the anon key from anywhere. This just means a visitor with
  // no invite gets a waitlist instead of a form that fails on submit.
  if (!betaToken && !inviteToken && !bypassGate) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <Card className="w-full max-w-md border-slate-800 bg-slate-900">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <UsersRound className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-white">
              ConvoReal is invite-only
            </CardTitle>
            <CardDescription className="text-slate-400">
              We&apos;re opening to 100 brokerages this month, each invited by
              someone already using it. Leave your number and we&apos;ll come
              to you when a seat frees up.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <WaitlistForm inviteState="no_invite" cta="Add me to the list" />

            <p className="text-center text-sm text-slate-400">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:text-primary/80">
                Sign in
              </Link>
            </p>

            <button
              type="button"
              onClick={() => setBypassGate(true)}
              className="text-center text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              My number is already registered with a team here
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <Card className="w-full max-w-md border-slate-800 bg-slate-900">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-white">
              Check your email
            </CardTitle>
            <CardDescription className="text-slate-400">
              We&apos;ve sent a confirmation link to{" "}
              <span className="text-white">{email}</span>. Please check your
              inbox and click the link to verify your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
            >
              <Button
                variant="outline"
                className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Back to sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            {inviteToken ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <MessageSquare className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl text-white">
            {inviteToken ? "Create account & join" : "Create account"}
          </CardTitle>
          <CardDescription className="text-slate-400">
            {inviteToken
              ? "Verify your email, then accept the invitation to join your team."
              : "Get started with the ConvoReal Engine"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-slate-300">
                Full name
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-slate-300">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-slate-300">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">
                Confirm password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
              className="text-primary hover:text-primary/80"
            >
              Sign in
            </Link>
          </p>

          <p className="mt-3 text-center text-[11px] font-medium text-slate-500">
            After signup you&apos;ll verify your WhatsApp number — ConvoReal is a WhatsApp-based
            platform, it&apos;s how your enquiries and alerts reach you.
          </p>

          {/* Property owners get their own portal — the Owners Den. */}
          <Link
            href="/den/login"
            className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 transition-colors hover:bg-amber-500/10"
          >
            <span className="text-xs font-bold text-amber-400">
              Own a property? List &amp; manage it in your Portfolio
            </span>
            <span className="shrink-0 text-xs font-black text-amber-400">→</span>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
