import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

let _adminClient: ReturnType<typeof createAdminClient> | null = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

async function checkAdminAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.role !== 'super_admin') {
    return { authorized: false, status: 403, error: 'Forbidden' };
  }

  return { authorized: true, userId: user.id };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await checkAdminAuth(supabase);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Load sandbox config
    const { data: setting } = await supabaseAdmin()
      .from('system_settings')
      .select('value')
      .eq('key', 'sandbox_config')
      .maybeSingle();

    const config = ((setting as unknown as { value?: Record<string, unknown> })?.value) || {};

    // If no credentials, return not configured
    if (!config.access_token || !config.phone_number_id) {
      return NextResponse.json({
        connected: false,
        message: 'Sandbox not configured. Enter credentials in admin panel.',
      });
    }

    // Test connection with Meta
    try {
      const decryptedToken = decrypt(config.access_token as string);
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id as string,
        accessToken: decryptedToken,
      });

      return NextResponse.json({
        connected: true,
        phone_info: phoneInfo,
        display_name: config.display_name,
        enabled: config.enabled,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Meta API verification failed';
      return NextResponse.json({
        connected: false,
        message,
      });
    }
  } catch (error) {
    console.error('Error in GET sandbox-config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const auth = await checkAdminAuth(supabase);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const {
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      display_name,
      enabled,
    } = body;

    // Load existing config
    const { data: existing } = await supabaseAdmin()
      .from('system_settings')
      .select('value')
      .eq('key', 'sandbox_config')
      .maybeSingle();

    const existingConfig = ((existing as unknown as { value?: Record<string, unknown> })?.value) || {};

    // Build new config
    const newConfig: Record<string, unknown> = {
      ...existingConfig,
      phone_number_id: phone_number_id || existingConfig.phone_number_id || null,
      waba_id: waba_id !== undefined ? waba_id : existingConfig.waba_id || null,
      verify_token: verify_token !== undefined ? verify_token : existingConfig.verify_token || null,
      display_name: display_name || existingConfig.display_name || 'ConvoReal Sandbox',
      enabled: typeof enabled === 'boolean' ? enabled : existingConfig.enabled || false,
    };

    // Encrypt and store token if provided
    if (access_token && access_token !== '••••••••••••••••') {
      newConfig.access_token = encrypt(access_token);
    } else if (!existingConfig.access_token) {
      return NextResponse.json(
        { error: 'Access token is required for sandbox configuration' },
        { status: 400 }
      );
    }

    // Verify with Meta if credentials changed
    if (access_token && access_token !== '••••••••••••••••' && phone_number_id) {
      try {
        await verifyPhoneNumber({
          phoneNumberId: phone_number_id,
          accessToken: access_token,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Meta API verification failed';
        return NextResponse.json(
          { error: `Invalid credentials: ${message}` },
          { status: 400 }
        );
      }
      // Now encrypt it
      newConfig.access_token = encrypt(access_token);
    }

    // Save to system_settings
    const { error: upsertError } = await supabaseAdmin()
      .from('system_settings')
      .upsert({
        key: 'sandbox_config',
        value: newConfig,
        updated_at: new Date().toISOString(),
      } as unknown as never[]);

    if (upsertError) {
      console.error('Error saving sandbox config:', upsertError);
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
    }

    return NextResponse.json({ success: true, config: newConfig });
  } catch (error) {
    console.error('Error in POST sandbox-config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
