import { META_API_BASE } from '@/lib/whatsapp/meta-api';

export interface PhoneRegistrationState {
  status: string | null;
  platformType: string | null;
  nameStatus: string | null;
  verifiedName: string | null;
  pinEnabled: boolean | null;
}

export interface RegistrationAssessment {
  registered: boolean;
  nameApproved: boolean | null;
  reason: string | null;
}

const APPROVED_NAME_STATUSES = new Set([
  'APPROVED',
  'AVAILABLE_WITHOUT_REVIEW',
]);

export async function fetchPhoneRegistrationState(args: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<PhoneRegistrationState | null> {
  try {
    const res = await fetch(
      `${META_API_BASE}/${args.phoneNumberId}?fields=status,platform_type,name_status,verified_name,is_pin_enabled`,
      { headers: { Authorization: `Bearer ${args.accessToken}` } }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: string;
      platform_type?: string;
      name_status?: string;
      verified_name?: string;
      is_pin_enabled?: boolean;
    };
    return {
      status: body.status ?? null,
      platformType: body.platform_type ?? null,
      nameStatus: body.name_status ?? null,
      verifiedName: body.verified_name ?? null,
      pinEnabled:
        typeof body.is_pin_enabled === 'boolean' ? body.is_pin_enabled : null,
    };
  } catch {
    return null;
  }
}

export function assessRegistration(
  state: PhoneRegistrationState | null
): RegistrationAssessment | null {
  if (!state || !state.platformType) return null;

  const nameApproved = state.nameStatus
    ? APPROVED_NAME_STATUSES.has(state.nameStatus)
    : null;
  const registered = state.platformType === 'CLOUD_API';
  if (registered) {
    return { registered: true, nameApproved, reason: null };
  }

  if (state.nameStatus === 'DECLINED') {
    const name = state.verifiedName ? ` "${state.verifiedName}"` : '';
    return {
      registered: false,
      nameApproved,
      reason: `Meta declined the display name${name}, so the number cannot be registered. Submit a new name in WhatsApp Manager, wait for approval, then enter the two-step PIN here and save.`,
    };
  }

  const status = state.status ? ` (status ${state.status})` : '';
  return {
    registered: false,
    nameApproved,
    reason: `Meta reports this number is not registered with the Cloud API${status}. Enter the two-step PIN and save to register it.`,
  };
}
