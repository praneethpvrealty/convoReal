import { createClient } from '@supabase/supabase-js'

let _adminClient: ReturnType<typeof createClient> | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export interface SandboxSystemConfig {
  phone_number_id: string | null
  waba_id: string | null
  access_token: string | null
  verify_token: string | null
  enabled: boolean
  display_name: string
}

export async function getSystemSetting<T = unknown>(key: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin()
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error || !data) return null
  return (data as { value: unknown }).value as T
}

export async function setSystemSetting(key: string, value: unknown): Promise<boolean> {
  const payload = { key, value, updated_at: new Date().toISOString() }
  const { error } = await supabaseAdmin()
    .from('system_settings')
    .upsert(payload as unknown as never[])

  if (error) {
    console.error(`[SystemSettings] Failed to set ${key}:`, error)
    return false
  }
  return true
}

export async function getSandboxSystemConfig(): Promise<SandboxSystemConfig> {
  const config = await getSystemSetting<SandboxSystemConfig>('sandbox_config')
  return config || {
    phone_number_id: null,
    waba_id: null,
    access_token: null,
    verify_token: null,
    enabled: false,
    display_name: 'ConvoReal Sandbox',
  }
}

export async function setSandboxSystemConfig(config: SandboxSystemConfig): Promise<boolean> {
  return setSystemSetting('sandbox_config', config)
}
