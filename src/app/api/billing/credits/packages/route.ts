import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getOrDetectBillingGateway } from '@/lib/credits/currency';
import { billingAdmin } from '@/lib/billing/admin-client';

// GET /api/billing/credits/packages — 4 top-up packages priced in the
// caller's detected currency.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { currency, gateway } = await getOrDetectBillingGateway(ctx.accountId);

    const admin = billingAdmin();
    const { data: packages, error } = await admin
      .from('credit_packages')
      .select('key, name, credits, display_order, credit_package_prices!inner(currency, gateway, amount_minor)')
      .eq('is_active', true)
      .eq('credit_package_prices.currency', currency)
      .eq('credit_package_prices.is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[GET /api/billing/credits/packages] query error:', error);
      return NextResponse.json({ error: 'Failed to load packages' }, { status: 500 });
    }

    const shaped = (packages ?? []).map((pkg) => {
      const price = Array.isArray(pkg.credit_package_prices) ? pkg.credit_package_prices[0] : pkg.credit_package_prices;
      return {
        key: pkg.key,
        name: pkg.name,
        credits: pkg.credits,
        amountMinor: price?.amount_minor ?? 0,
        currency,
        gateway: price?.gateway ?? gateway,
      };
    });

    return NextResponse.json({ packages: shaped, currency, gateway });
  } catch (err) {
    return toErrorResponse(err);
  }
}
