import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createRazorpayOrder } from '@/lib/marketplace/razorpay';

// POST /api/create-order
// Request: { amount: number, currency?: string, receipt?: string }
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const amount = Number(body.amount); // in paise
    const currency = String(body.currency || 'INR');
    const receipt = String(body.receipt || `rcpt_${Date.now()}`);

    // Validate amount >= 100 paise
    if (isNaN(amount) || amount < 100) {
      return NextResponse.json(
        { error: 'Amount must be at least 100 paise (1 INR)' },
        { status: 400 }
      );
    }

    const order = await createRazorpayOrder({
      amountCents: amount,
      currency,
      receipt,
      notes: {
        user_id: user.id,
        source: 'standard_web_checkout',
      },
    });

    return NextResponse.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: order.keyId,
    });
  } catch (error: any) {
    console.error('[create-order] failed:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
