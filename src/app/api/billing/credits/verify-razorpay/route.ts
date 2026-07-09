import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import { creditPurchase } from '@/lib/credits/grant';

interface RazorpayPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

interface RazorpayPaymentsResponse {
  items?: RazorpayPayment[];
}

// POST /api/billing/credits/verify-razorpay
// Body: { orderId: string }
// Verifies a Razorpay payment and grants credits if successful.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const supabase = await createClient();

    const body = await request.json().catch(() => ({}));
    const orderId = String(body?.orderId ?? '');

    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // Get the order details from our database
    const { data: order, error: orderErr } = await supabase
      .from('razorpay_orders')
      .select('*')
      .eq('order_id', orderId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Check Razorpay API for payment status
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return NextResponse.json({ error: 'Razorpay not configured' }, { status: 500 });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const rzRes = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!rzRes.ok) {
      const errBody = await rzRes.json().catch(() => ({}));
      console.error('[verify-razorpay] Razorpay API error:', errBody);
      return NextResponse.json({ error: 'Failed to fetch payment status from Razorpay' }, { status: 500 });
    }

    const rzData = (await rzRes.json()) as RazorpayPaymentsResponse;
    const payments = rzData.items ?? [];

    // Find a captured payment
    const capturedPayment = payments.find((p) => p.status === 'captured');

    if (!capturedPayment) {
      return NextResponse.json({
        success: false,
        message: 'No captured payment found for this order',
        payments: payments.map((p) => ({ id: p.id, status: p.status })),
      });
    }

    // Grant credits using the existing creditPurchase function
    const result = await creditPurchase({
      accountId: ctx.accountId,
      packageKey: order.package_key,
      gateway: 'razorpay',
      gatewayOrderId: orderId,
      gatewayPaymentId: capturedPayment.id,
      currency: order.currency,
    });

    // Update the order status in our database
    await supabase
      .from('razorpay_orders')
      .update({ status: 'paid', payment_id: capturedPayment.id })
      .eq('id', order.id);

    if (result.credited) {
      return NextResponse.json({
        success: true,
        message: `Successfully granted ${result.credits} credits`,
        credits: result.credits,
      });
    } else {
      return NextResponse.json({
        success: false,
        message: 'Credits were not granted (may have already been processed)',
        credits: 0,
      });
    }
  } catch (err) {
    console.error('[verify-razorpay] error:', err);
    return toErrorResponse(err);
  }
}
