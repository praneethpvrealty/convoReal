import type { SupabaseClient } from '@supabase/supabase-js';
import { UserFacingError } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  subscribeWabaToApp,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from '@/lib/whatsapp/meta-api';
import {
  assessRegistration,
  fetchPhoneRegistrationState,
} from '@/lib/whatsapp/registration-state';

export const NUMBER_PROFILE_LABEL_MAX = 60;
export const AUTO_REPLY_MESSAGE_MAX = 600;

export interface NumberProfileRow {
  id: string;
  account_id: string;
  label: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  waba_id: string | null;
  access_token: string;
  verify_token: string | null;
  catalog_id: string | null;
  auto_sync_catalog: boolean;
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
  last_activated_at: string | null;
  auto_reply_enabled: boolean;
  auto_reply_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface NumberProfileSummary {
  id: string;
  label: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  waba_id: string | null;
  catalog_id: string | null;
  auto_sync_catalog: boolean;
  registered_at: string | null;
  last_registration_error: string | null;
  last_activated_at: string | null;
  auto_reply_enabled: boolean;
  auto_reply_message: string | null;
  created_at: string;
  is_active: boolean;
}

export interface NumberProfileSnapshot {
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  waba_id: string | null;
  access_token: string;
  verify_token: string | null;
  catalog_id: string | null;
  auto_sync_catalog: boolean;
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
}

interface LiveConfigLike {
  phone_number_id: string | null;
  integration_type: string | null;
  waba_id?: string | null;
  access_token?: string | null;
  display_phone_number?: string | null;
  verify_token?: string | null;
  catalog_id?: string | null;
  auto_sync_catalog?: boolean | null;
  registered_at?: string | null;
  subscribed_apps_at?: string | null;
  last_registration_error?: string | null;
}

export function isProfileActive(
  profile: Pick<NumberProfileRow, 'phone_number_id'>,
  live: LiveConfigLike | null
): boolean {
  if (!live) return false;
  if ((live.integration_type || 'official_api') !== 'official_api')
    return false;
  return live.phone_number_id === profile.phone_number_id;
}

export function summarizeProfile(
  row: NumberProfileRow,
  live: LiveConfigLike | null
): NumberProfileSummary {
  return {
    id: row.id,
    label: row.label,
    phone_number_id: row.phone_number_id,
    display_phone_number: row.display_phone_number,
    verified_name: row.verified_name,
    waba_id: row.waba_id,
    catalog_id: row.catalog_id,
    auto_sync_catalog: row.auto_sync_catalog,
    registered_at: row.registered_at,
    last_registration_error: row.last_registration_error,
    last_activated_at: row.last_activated_at,
    auto_reply_enabled: row.auto_reply_enabled ?? false,
    auto_reply_message: row.auto_reply_message ?? null,
    created_at: row.created_at,
    is_active: isProfileActive(row, live),
  };
}

export function snapshotFromLiveConfig(
  live: LiveConfigLike
): NumberProfileSnapshot | null {
  if ((live.integration_type || 'official_api') !== 'official_api') return null;
  if (!live.phone_number_id || !live.access_token) return null;
  return {
    phone_number_id: live.phone_number_id,
    display_phone_number: live.display_phone_number ?? null,
    verified_name: null,
    waba_id: live.waba_id ?? null,
    access_token: live.access_token,
    verify_token: live.verify_token ?? null,
    catalog_id: live.catalog_id ?? null,
    auto_sync_catalog: live.auto_sync_catalog ?? false,
    registered_at: live.registered_at ?? null,
    subscribed_apps_at: live.subscribed_apps_at ?? null,
    last_registration_error: live.last_registration_error ?? null,
  };
}

export function liveConfigFromProfile(
  profile: NumberProfileRow,
  phoneInfo: MetaPhoneInfo | null,
  subscribedAppsAt: string | null,
  now: string
): Record<string, unknown> {
  return {
    integration_type: 'official_api',
    phone_number_id: profile.phone_number_id,
    display_phone_number:
      phoneInfo?.display_phone_number || profile.display_phone_number,
    waba_id: profile.waba_id,
    access_token: profile.access_token,
    verify_token: profile.verify_token,
    catalog_id: profile.catalog_id,
    auto_sync_catalog: profile.auto_sync_catalog,
    status: 'connected',
    connected_at: now,
    registered_at: profile.registered_at,
    subscribed_apps_at: subscribedAppsAt ?? profile.subscribed_apps_at,
    last_registration_error: null,
    flows_key_registered_at: null,
    updated_at: now,
  };
}

export function normalizeProfileLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label.trim().slice(0, NUMBER_PROFILE_LABEL_MAX);
}

export function normalizeAutoReplyMessage(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new UserFacingError('auto_reply_message must be text.', 400);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > AUTO_REPLY_MESSAGE_MAX) {
    throw new UserFacingError(
      `Keep the auto-reply under ${AUTO_REPLY_MESSAGE_MAX} characters.`,
      400
    );
  }
  return trimmed;
}

export async function isPhoneNumberClaimedElsewhere(
  admin: SupabaseClient,
  phoneNumberId: string,
  accountId: string
): Promise<boolean> {
  const [{ data: live, error: liveError }, { data: saved, error: savedError }] =
    await Promise.all([
      admin
        .from('whatsapp_config')
        .select('account_id')
        .eq('phone_number_id', phoneNumberId)
        .neq('account_id', accountId)
        .maybeSingle(),
      admin
        .from('whatsapp_number_profiles')
        .select('account_id')
        .eq('phone_number_id', phoneNumberId)
        .neq('account_id', accountId)
        .maybeSingle(),
    ]);
  if (liveError) throw liveError;
  if (savedError) throw savedError;
  return Boolean(live || saved);
}

export async function upsertNumberProfile(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    snapshot: NumberProfileSnapshot;
    label?: string;
    activatedAt?: string | null;
    live?: boolean;
  }
): Promise<void> {
  const row: Record<string, unknown> = {
    account_id: args.accountId,
    created_by: args.userId,
    ...args.snapshot,
    updated_at: new Date().toISOString(),
  };
  if (args.label !== undefined) row.label = normalizeProfileLabel(args.label);
  if (args.activatedAt !== undefined) row.last_activated_at = args.activatedAt;
  if (args.live) row.auto_reply_enabled = false;
  const { error } = await db
    .from('whatsapp_number_profiles')
    .upsert(row, { onConflict: 'phone_number_id' });
  if (error) throw error;
}

export async function listNumberProfiles(
  db: SupabaseClient,
  accountId: string
): Promise<NumberProfileSummary[]> {
  const [{ data: rows, error }, { data: live, error: liveError }] =
    await Promise.all([
      db
        .from('whatsapp_number_profiles')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true }),
      db
        .from('whatsapp_config')
        .select('phone_number_id, integration_type')
        .eq('account_id', accountId)
        .maybeSingle(),
    ]);
  if (error) throw error;
  if (liveError) throw liveError;
  return ((rows ?? []) as NumberProfileRow[]).map((row) =>
    summarizeProfile(row, (live as LiveConfigLike | null) ?? null)
  );
}

async function loadProfile(
  db: SupabaseClient,
  accountId: string,
  profileId: string
): Promise<NumberProfileRow> {
  const { data, error } = await db
    .from('whatsapp_number_profiles')
    .select('*')
    .eq('id', profileId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('Saved number not found.', 404);
  return data as NumberProfileRow;
}

async function loadLiveConfig(
  db: SupabaseClient,
  accountId: string
): Promise<(LiveConfigLike & { id: string }) | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as (LiveConfigLike & { id: string }) | null) ?? null;
}

export async function renameNumberProfile(
  db: SupabaseClient,
  args: { accountId: string; profileId: string; label: unknown }
): Promise<NumberProfileSummary> {
  const label = normalizeProfileLabel(args.label);
  const { data, error } = await db
    .from('whatsapp_number_profiles')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', args.profileId)
    .eq('account_id', args.accountId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('Saved number not found.', 404);
  const live = await loadLiveConfig(db, args.accountId);
  return summarizeProfile(data as NumberProfileRow, live);
}

export async function setNumberProfileAutoReply(
  db: SupabaseClient,
  args: {
    accountId: string;
    profileId: string;
    enabled?: unknown;
    message?: unknown;
  }
): Promise<NumberProfileSummary> {
  const profile = await loadProfile(db, args.accountId, args.profileId);
  const live = await loadLiveConfig(db, args.accountId);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (args.enabled !== undefined) {
    if (typeof args.enabled !== 'boolean') {
      throw new UserFacingError(
        'auto_reply_enabled must be true or false.',
        400
      );
    }
    if (args.enabled && isProfileActive(profile, live)) {
      throw new UserFacingError(
        'The live number cannot auto-reply. Switch to another number first.',
        400
      );
    }
    patch.auto_reply_enabled = args.enabled;
  }
  if (args.message !== undefined) {
    patch.auto_reply_message = normalizeAutoReplyMessage(args.message);
  }
  const { data, error } = await db
    .from('whatsapp_number_profiles')
    .update(patch)
    .eq('id', args.profileId)
    .eq('account_id', args.accountId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError('Saved number not found.', 404);
  return summarizeProfile(data as NumberProfileRow, live);
}

export async function deleteNumberProfile(
  db: SupabaseClient,
  args: { accountId: string; profileId: string }
): Promise<void> {
  const [profile, live] = await Promise.all([
    loadProfile(db, args.accountId, args.profileId),
    loadLiveConfig(db, args.accountId),
  ]);
  if (isProfileActive(profile, live)) {
    throw new UserFacingError(
      'This number is live right now. Switch to another saved number first, or use Reset Configuration.',
      409
    );
  }
  const { error } = await db
    .from('whatsapp_number_profiles')
    .delete()
    .eq('id', args.profileId)
    .eq('account_id', args.accountId);
  if (error) throw error;
}

export interface ActivateNumberProfileResult {
  profile: NumberProfileSummary;
  already_active: boolean;
  waba_changed: boolean;
  registered: boolean;
  registration_error: string | null;
  phone_info: MetaPhoneInfo | null;
}

export async function activateNumberProfile(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    profileId: string;
    verify?: typeof verifyPhoneNumber;
    subscribe?: typeof subscribeWabaToApp;
    registrationState?: typeof fetchPhoneRegistrationState;
    now?: () => string;
  }
): Promise<ActivateNumberProfileResult> {
  const verify = args.verify ?? verifyPhoneNumber;
  const subscribe = args.subscribe ?? subscribeWabaToApp;
  const registrationState =
    args.registrationState ?? fetchPhoneRegistrationState;
  const now = args.now ?? (() => new Date().toISOString());

  const [profile, live] = await Promise.all([
    loadProfile(db, args.accountId, args.profileId),
    loadLiveConfig(db, args.accountId),
  ]);

  if (isProfileActive(profile, live)) {
    return {
      profile: summarizeProfile(profile, live),
      already_active: true,
      waba_changed: false,
      registered: profile.registered_at != null,
      registration_error: profile.last_registration_error,
      phone_info: null,
    };
  }

  const outgoing = live ? snapshotFromLiveConfig(live) : null;
  if (outgoing) {
    await upsertNumberProfile(db, {
      accountId: args.accountId,
      userId: args.userId,
      snapshot: outgoing,
    });
  }

  let accessToken: string;
  try {
    accessToken = decrypt(profile.access_token);
  } catch {
    throw new UserFacingError(
      'The token saved for this number cannot be decrypted. Re-enter its credentials in the form below and save to repair it.',
      409
    );
  }

  let phoneInfo: MetaPhoneInfo;
  try {
    phoneInfo = await verify({
      phoneNumberId: profile.phone_number_id,
      accessToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UserFacingError(
      `Meta rejected the saved credentials for this number: ${message}. Re-enter its token in the form below and save to refresh it.`,
      400
    );
  }

  let subscribedAppsAt: string | null = null;
  if (profile.waba_id) {
    try {
      await subscribe({ wabaId: profile.waba_id, accessToken });
      subscribedAppsAt = now();
    } catch (err) {
      console.warn(
        '[number-profiles] WABA subscribed_apps failed (non-fatal):',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const assessment = assessRegistration(
    await registrationState({
      phoneNumberId: profile.phone_number_id,
      accessToken,
    })
  );
  const registered = assessment
    ? assessment.registered
    : profile.registered_at != null;
  const registrationError =
    assessment && !assessment.registered ? assessment.reason : null;

  const activatedAt = now();
  const numberChanged =
    live != null &&
    (live.integration_type || 'official_api') === 'official_api' &&
    live.phone_number_id != null &&
    live.phone_number_id !== profile.phone_number_id &&
    Boolean(live.display_phone_number);
  const row = {
    ...liveConfigFromProfile(profile, phoneInfo, subscribedAppsAt, activatedAt),
    status: registered ? 'connected' : 'disconnected',
    connected_at: registered ? activatedAt : null,
    registered_at: registered ? (profile.registered_at ?? activatedAt) : null,
    last_registration_error: registrationError,
    ...(numberChanged
      ? {
          previous_display_phone_number: live.display_phone_number,
          number_changed_at: activatedAt,
        }
      : {}),
  };

  if (live) {
    const { data: updated, error } = await db
      .from('whatsapp_config')
      .update(row)
      .eq('account_id', args.accountId)
      .select('id');
    if (error) throw error;
    if (!updated?.length) {
      throw new UserFacingError('No WhatsApp configuration to update.', 404);
    }
  } else {
    const { error } = await db.from('whatsapp_config').insert({
      account_id: args.accountId,
      user_id: args.userId,
      ...row,
    });
    if (error) throw error;
  }

  const { data: refreshed, error: refreshError } = await db
    .from('whatsapp_number_profiles')
    .update({
      display_phone_number:
        phoneInfo.display_phone_number || profile.display_phone_number,
      verified_name: phoneInfo.verified_name ?? profile.verified_name,
      subscribed_apps_at: subscribedAppsAt ?? profile.subscribed_apps_at,
      registered_at: registered ? (profile.registered_at ?? activatedAt) : null,
      last_registration_error: registrationError,
      last_activated_at: activatedAt,
      auto_reply_enabled: false,
      updated_at: activatedAt,
    })
    .eq('id', profile.id)
    .eq('account_id', args.accountId)
    .select('*')
    .maybeSingle();
  if (refreshError) throw refreshError;

  const finalProfile = (refreshed as NumberProfileRow | null) ?? {
    ...profile,
    last_activated_at: activatedAt,
    auto_reply_enabled: false,
  };

  return {
    profile: summarizeProfile(finalProfile, {
      phone_number_id: profile.phone_number_id,
      integration_type: 'official_api',
    }),
    already_active: false,
    waba_changed: (live?.waba_id ?? null) !== (profile.waba_id ?? null),
    registered,
    registration_error: registrationError,
    phone_info: phoneInfo,
  };
}
