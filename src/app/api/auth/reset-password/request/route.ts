import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendTransactionalEmail } from '@/lib/email';
import crypto from 'crypto';

/**
 * Generates an HMAC-signed password-reset token that encodes the user ID
 * and an expiry timestamp.  No Supabase redirect flow needed — the token
 * travels as a plain query parameter and is verified server-side when the
 * user submits a new password.
 */
function generateResetToken(userId: string, secret: string): string {
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  // URL-safe base64 of "userId.expiresAt.signature"
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase admin client is not configured' },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Look up the user by email so we can embed their ID in the token
    const { data: userList, error: listError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }

    const user = userList.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      // Don't reveal whether the email exists — return success silently
      return NextResponse.json({ success: true });
    }

    // Build the signed token and reset URL
    const token = generateResetToken(user.id, supabaseServiceKey);
    const requestUrl = new URL(request.url);
    const origin = requestUrl.origin;
    const resetLink = `${origin}/reset-password?token=${token}`;

    // Build the email template
    const appName = process.env.NEXT_PUBLIC_DEFAULT_WEBSITE_NAME || 'ConvoReal';
    const emailSubject = `Reset your ${appName} password`;
    const emailHtml = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 570px; margin: 0 auto; padding: 32px 24px; color: #0f172a; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05);">
        <h2 style="color: #7c3aed; margin-top: 0; margin-bottom: 16px; font-size: 20px; font-weight: 700; text-align: center;">Reset Your Password</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
          You requested to reset your password for your <strong>${appName}</strong> account. Click the button below to choose a new password:
        </p>
        <div style="text-align: center; margin-bottom: 28px;">
          <a href="${resetLink}" style="display: inline-block; background-color: #7c3aed; color: #ffffff !important; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; box-shadow: 0 4px 10px rgba(124, 58, 237, 0.25);">
            Reset Password
          </a>
        </div>
        <p style="font-size: 13px; line-height: 1.6; color: #64748b; margin-bottom: 20px;">
          If you did not request a password reset, you can safely ignore this email. This link is valid for 1 hour.
        </p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 20px;" />
        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; text-align: center; margin: 0;">
          If you're having trouble with the button above, copy and paste the link below into your web browser:
        </p>
        <p style="font-size: 11px; line-height: 1.5; color: #64748b; text-align: center; word-break: break-all; margin-top: 8px; margin-bottom: 0;">
          <a href="${resetLink}" style="color: #7c3aed; text-decoration: underline;">${resetLink}</a>
        </p>
      </div>
    `;

    // Try sending email
    const res = await sendTransactionalEmail({
      to: email,
      subject: emailSubject,
      html: emailHtml,
    });

    if (!res.success) {
      // Fallback logging for local setup
      console.log('==================================================');
      console.log(`[AUTH CLIENT] Password reset link for ${email}:`);
      console.log(resetLink);
      console.log('==================================================');
      // If it failed because resend is not configured, we return success so local devs see it in terminal
      if (res.error === 'Email service not configured') {
        return NextResponse.json({
          success: true,
          message: 'Development Mode: Reset link logged to console.',
        });
      }
      return NextResponse.json({ error: res.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
