import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getRazorpayCredentials } from '@/lib/marketplace/razorpay';
import crypto from 'crypto';

// POST /api/verify-payment
// Request: { razorpay_payment_id: string, razorpay_order_id: string, razorpay_signature: string }
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
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return NextResponse.json(
        { error: 'Missing required fields: razorpay_payment_id, razorpay_order_id, razorpay_signature' },
        { status: 400 }
      );
    }

    const creds = getRazorpayCredentials();
    if (!creds) {
      return NextResponse.json(
        { error: 'Razorpay configuration is missing on the server.' },
        { status: 500 }
      );
    }

    // Verify signature: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const hmac = crypto.createHmac('sha256', creds.keySecret);
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return NextResponse.json(
        { error: 'Payment verification failed. Signature mismatch.' },
        { status: 400 }
      );
    }

    // signature matched
    return NextResponse.json({
      success: true,
      message: 'Payment verified successfully.',
    });
  } catch (error: any) {
    console.error('[verify-payment] failed:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
