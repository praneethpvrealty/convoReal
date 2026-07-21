import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
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

async function checkSuperAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized', userId: null };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.role !== 'super_admin') {
    return { authorized: false, status: 403, error: 'Forbidden', userId: null };
  }

  return { authorized: true, userId: user.id, status: 200, error: null };
}

// POST /api/admin/credits/manual-grant
// Body: { orderId: string }
// Super-admin fallback for a captured Razorpay top-up that the webhook
// failed to process. The order (account, package, currency) is resolved
// server-side from razorpay_orders and the payment is verified as
// captured against Razorpay before any credit is granted — nothing from
// the request body is trusted beyond the order id.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const auth = await checkSuperAdmin(supabase);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const orderId = String(body?.orderId ?? '');
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: order, error: orderErr } = await admin
      .from('razorpay_orders')
      .select('id, account_id, package_key, currency')
      .eq('order_id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return NextResponse.json({ error: 'Razorpay not configured' }, { status: 500 });
    }

    const rzAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const rzRes = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
      headers: { Authorization: `Basic ${rzAuth}` },
    });

    if (!rzRes.ok) {
      const errBody = await rzRes.json().catch(() => ({}));
      console.error('[admin/credits/manual-grant] Razorpay API error:', errBody);
      return NextResponse.json({ error: 'Failed to fetch payment status from Razorpay' }, { status: 502 });
    }

    const rzData = (await rzRes.json()) as RazorpayPaymentsResponse;
    const capturedPayment = (rzData.items ?? []).find((p) => p.status === 'captured');

    if (!capturedPayment) {
      return NextResponse.json(
        { success: false, message: 'No captured payment found for this order' },
        { status: 402 },
      );
    }

    console.log(`[admin/credits/manual-grant] Granting credits for order ${orderId} by super-admin ${auth.userId}`);

    const result = await creditPurchase({
      accountId: order.account_id,
      packageKey: order.package_key,
      gateway: 'razorpay',
      gatewayOrderId: orderId,
      gatewayPaymentId: capturedPayment.id,
      currency: order.currency,
    });

    await admin
      .from('razorpay_orders')
      .update({ status: 'paid', payment_id: capturedPayment.id })
      .eq('id', order.id);

    if (result.credited) {
      return NextResponse.json({
        success: true,
        message: `Successfully granted ${result.credits} credits`,
        credits: result.credits,
      });
    }

    return NextResponse.json({
      success: false,
      message: 'Credits were not granted (may have already been processed)',
      credits: 0,
    });
  } catch (err) {
    console.error('[admin/credits/manual-grant] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
