import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET /api/billing/invoices
// Proxies to Razorpay to fetch invoices for this account's subscription.
export async function GET() {
  try {
    const ctx = await requireRole('owner');

    const { data: sub } = await ctx.supabase
      .from('subscriptions')
      .select('razorpay_subscription_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!sub?.razorpay_subscription_id) {
      return NextResponse.json({ invoices: [] });
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpayKeySecret) {
      return NextResponse.json({ invoices: [] });
    }

    const credentials = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const rzRes = await fetch(
      `https://api.razorpay.com/v1/invoices?subscription_id=${sub.razorpay_subscription_id}&count=24`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    if (!rzRes.ok) {
      return NextResponse.json({ invoices: [] });
    }

    const data = await rzRes.json();
    const invoices = (data.items ?? []).map((inv: Record<string, unknown>) => ({
      id: inv.id,
      date: inv.date,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      short_url: inv.short_url,
    }));

    return NextResponse.json({ invoices });
  } catch (err) {
    return toErrorResponse(err);
  }
}
