import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { syncProductToCatalog } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }

    // 1. Fetch property
    const { data: property, error: propErr } = await ctx.supabase
      .from('properties')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (propErr || !property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    // JV/JD and Built to Suit deals don't have Meta-catalog-compatible sale/
    // rent pricing — refuse the sync with a clear reason instead of pushing
    // a malformed catalog entry.
    if (property.listing_type === 'JV/JD' || property.listing_type === 'Built to Suit') {
      return NextResponse.json(
        { error: `${property.listing_type} listings can't be synced to Meta Catalog — it only supports Sale/Rent pricing.` },
        { status: 400 }
      )
    }

    // 2. Fetch whatsapp_config for account
    const { data: config, error: configErr } = await ctx.supabase
      .from('whatsapp_config')
      .select('access_token, catalog_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (configErr) {
      console.error('[sync-catalog] config fetch error:', configErr)
      return NextResponse.json({ error: 'Failed to fetch WhatsApp configuration' }, { status: 500 })
    }

    if (!config || !config.catalog_id) {
      return NextResponse.json(
        { error: 'Meta Catalog is not configured for this account. Set it in WhatsApp settings.' },
        { status: 400 }
      )
    }

    // 3. Decrypt access token
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (decErr) {
      const msg = decErr instanceof Error ? decErr.message : String(decErr)
      return NextResponse.json({ error: `Decryption failed: ${msg}` }, { status: 500 })
    }

    // 4. Sync product to Meta Catalog
    try {
      await syncProductToCatalog({
        catalogId: config.catalog_id,
        accessToken,
        property,
      })

      // Update db row
      await ctx.supabase
        .from('properties')
        .update({
          meta_catalog_synced_at: new Date().toISOString(),
          meta_catalog_error: null,
        })
        .eq('id', id)

      return NextResponse.json({ success: true, synced_at: new Date().toISOString() })
    } catch (syncErr) {
      const errMsg = syncErr instanceof Error ? syncErr.message : String(syncErr)
      
      // Update db error
      await ctx.supabase
        .from('properties')
        .update({
          meta_catalog_error: errMsg,
        })
        .eq('id', id)

      return NextResponse.json({ error: `Sync failed: ${errMsg}` }, { status: 520 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
