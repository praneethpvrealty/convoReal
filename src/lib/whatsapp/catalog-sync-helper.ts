import type { SupabaseClient } from '@supabase/supabase-js'
import { syncProductToCatalog } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Checks the active account's whatsapp_config for auto_sync_catalog,
 * retrieves credentials, and synchronizes the property with Meta's Catalog.
 */
export async function autoSyncPropertyCatalogIfNeeded(
  supabase: SupabaseClient,
  propertyId: string,
  accountId: string
): Promise<void> {
  try {
    // 1. Fetch whatsapp_config for this account
    const { data: config, error: configErr } = await supabase
      .from('whatsapp_config')
      .select('access_token, catalog_id, auto_sync_catalog')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configErr) {
      console.error(`[Auto-Sync] Error loading config for account ${accountId}:`, configErr.message)
      return
    }

    if (!config || !config.catalog_id || !config.auto_sync_catalog) {
      // Auto-sync is not configured or disabled
      return
    }

    // 2. Fetch the property details
    const { data: property, error: propErr } = await supabase
      .from('properties')
      .select('*')
      .eq('id', propertyId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (propErr || !property) {
      console.warn(`[Auto-Sync] Property ${propertyId} not found or access denied.`)
      return
    }

    // 3. Decrypt the access token
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (decErr) {
      const errMsg = decErr instanceof Error ? decErr.message : String(decErr)
      console.error('[Auto-Sync] Token decryption failed:', errMsg)
      await supabase
        .from('properties')
        .update({
          meta_catalog_error: `Token decryption failed: ${errMsg}`,
        })
        .eq('id', propertyId)
      return
    }

    // 4. Trigger Meta Sync
    console.log(`[Auto-Sync] Synchronizing property ${propertyId} to Meta Catalog ${config.catalog_id}...`)
    await syncProductToCatalog({
      catalogId: config.catalog_id,
      accessToken,
      property,
    })

    // 5. Update success audit timestamp
    await supabase
      .from('properties')
      .update({
        meta_catalog_synced_at: new Date().toISOString(),
        meta_catalog_error: null,
      })
      .eq('id', propertyId)

    console.log(`[Auto-Sync] Successfully synchronized property ${propertyId}.`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[Auto-Sync] Error synchronizing property ${propertyId}:`, errorMsg)
    
    // Log error back to property row so it is visible in the UI
    try {
      await supabase
        .from('properties')
        .update({
          meta_catalog_error: errorMsg,
        })
        .eq('id', propertyId)
    } catch (dbErr) {
      console.error(`[Auto-Sync] Failed to log error to database:`, dbErr)
    }
  }
}
