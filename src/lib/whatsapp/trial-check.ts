import { supabaseAdmin } from '@/lib/supabase/admin';

// Lazy-initialized admin client for verification

export async function verifyWebhookTrialStatus(accountId: string) {
  const supabase = supabaseAdmin();
  
  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('integration_type, trial_ends_at')
    .eq('account_id', accountId)
    .single();

  if (error || !config) {
    return { allowed: false, reason: 'Configuration not found' };
  }

  const typedConfig = config as unknown as { integration_type: 'sandbox' | 'web_qr' | 'official_api'; trial_ends_at: string | null };

  // If Official API, access is always allowed
  if (typedConfig.integration_type === 'official_api') {
    return { allowed: true };
  }

  // Check trial expiration
  if (typedConfig.trial_ends_at && new Date() > new Date(typedConfig.trial_ends_at)) {
    return { 
      allowed: false, 
      reason: 'trial_expired',
      type: typedConfig.integration_type 
    };
  }

  return { allowed: true };
}
