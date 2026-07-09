import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';

interface RazorpayOrderRow {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  package_key: string;
}

// GET /api/billing/credits/pending-razorpay
// Returns recent Razorpay orders that were created but not yet credited.
// Used by the "Verify Recent Payments" button in the Credits tab.
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const supabase = await createClient();

    // Get recent orders from the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Query credit_transactions to find orders that were created
    // We'll check the Razorpay API for their status
    const { data: recentOrders, error } = await supabase
      .from('razorpay_orders')
      .select('id, order_id, amount, currency, status, created_at, package_key')
      .eq('account_id', ctx.accountId)
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[pending-razorpay] query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter to only orders that haven't been credited yet
    const pendingOrders = (recentOrders ?? []).filter((order: RazorpayOrderRow) => {
      return order.status === 'created' || order.status === 'attempted';
    });

    return NextResponse.json({ orders: pendingOrders });
  } catch (err) {
    console.error('[pending-razorpay] error:', err);
    return toErrorResponse(err);
  }
}
