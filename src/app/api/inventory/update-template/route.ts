import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { buildInventoryUpdateTemplatePayload } from '@/lib/whatsapp/inventory-update-template';

// GET /api/inventory/update-template
//
// The inventory_update template definition, for a surface that cannot
// import the builder. Mobile fetches this and POSTs it to
// /api/whatsapp/templates/submit — the same payload the web dialog
// submits, so the two cannot register different templates under one
// name (a name Meta reserves for four weeks after deletion; see the
// header of src/lib/whatsapp/inventory-update-template.ts).
export async function GET(request: Request) {
  try {
    await getCurrentAccount();
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin;
    return NextResponse.json({
      data: buildInventoryUpdateTemplatePayload(origin),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
