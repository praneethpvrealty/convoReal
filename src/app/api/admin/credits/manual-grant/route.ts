import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { creditPurchase } from '@/lib/credits/grant';

// POST /api/admin/credits/manual-grant
// Body: { razorpayPaymentId: string, razorpayOrderId: string, accountId: string, packageKey: string }
// Manually grants credits for a successful Razorpay payment when webhook fails.
// Admin-only endpoint.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const body = await request.json().catch(() => ({}));
    const razorpayPaymentId = String(body?.razorpayPaymentId ?? '');
    const razorpayOrderId = String(body?.razorpayOrderId ?? '');
    const accountId = String(body?.accountId ?? '');
    const packageKey = String(body?.packageKey ?? '');

    if (!razorpayPaymentId || !razorpayOrderId || !accountId || !packageKey) {
      return NextResponse.json(
        { error: 'razorpayPaymentId, razorpayOrderId, accountId, and packageKey are required' },
        { status: 400 }
      );
    }

    console.log(`[admin/credits/manual-grant] Manual credit grant requested by ${ctx.userId}`, {
      razorpayPaymentId,
      razorpayOrderId,
      accountId,
      packageKey,
    });

    const result = await creditPurchase({
      accountId,
      packageKey,
      gateway: 'razorpay',
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      currency: 'INR',
    });

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
    console.error('[admin/credits/manual-grant] Error:', err);
    return toErrorResponse(err);
  }
}
