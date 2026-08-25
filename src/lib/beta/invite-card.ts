import type { BetaInvitePreview } from '@/lib/beta/invite-preview';

export interface BetaInviteCardDetails {
  recipient: string;
  inviter: string;
  days: number | null;
  seatsLeft: number | null;
}

function truncate(value: string, length: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > length
    ? `${normalized.slice(0, length - 1).trimEnd()}…`
    : normalized;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function betaInvitePreviewDetails(
  preview: BetaInvitePreview | null
): BetaInviteCardDetails {
  const days = preview?.expires_at
    ? Math.max(
        1,
        Math.ceil(
          (new Date(preview.expires_at).getTime() - Date.now()) / 86_400_000
        )
      )
    : null;
  const seatsLeft =
    typeof preview?.account_cap === 'number' &&
    typeof preview.seats_taken === 'number'
      ? Math.max(0, preview.account_cap - preview.seats_taken)
      : null;

  return {
    recipient:
      preview?.ok && preview.label
        ? truncate(preview.label, 48)
        : 'A seat for you',
    inviter: preview?.inviter_name
      ? truncate(preview.inviter_name, 38)
      : 'ConvoReal',
    days,
    seatsLeft,
  };
}

export function betaInviteCardSvg(details: BetaInviteCardDetails): string {
  const recipient = escapeXml(details.recipient);
  const inviter = escapeXml(details.inviter);
  const heldFor =
    details.days === null
      ? 'Invite only'
      : `Held for ${details.days} ${details.days === 1 ? 'day' : 'days'}`;
  const availability =
    details.seatsLeft === null
      ? 'Private beta'
      : `${details.seatsLeft} beta seats left`;

  return `
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" x2="1">
          <stop offset="0" stop-color="#05040d" stop-opacity="0.99"/>
          <stop offset="0.55" stop-color="#05040d" stop-opacity="0.9"/>
          <stop offset="0.82" stop-color="#05040d" stop-opacity="0.12"/>
          <stop offset="1" stop-color="#05040d" stop-opacity="0.03"/>
        </linearGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#c084fc"/>
          <stop offset="1" stop-color="#6d28d9"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#shade)"/>
      <rect x="58" y="52" width="50" height="50" rx="15" fill="url(#brand)"/>
      <text x="83" y="88" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="31" font-weight="800">C</text>
      <text x="126" y="76" fill="#fff" font-family="Arial, sans-serif" font-size="28" font-weight="800">ConvoReal</text>
      <text x="126" y="99" fill="#c4b5fd" font-family="Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="3">PRIVATE BETA INVITATION</text>
      <text x="58" y="210" fill="#d8b4fe" font-family="Arial, sans-serif" font-size="29" font-weight="700">${recipient},</text>
      <text x="58" y="296" fill="#fff" font-family="Arial, sans-serif" font-size="67" font-weight="800" letter-spacing="-2">You&apos;ve been</text>
      <text x="58" y="366" fill="#fff" font-family="Arial, sans-serif" font-size="67" font-weight="800" letter-spacing="-2">personally invited.</text>
      <text x="58" y="424" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="23">A private seat reserved by ${inviter}</text>
      <text x="58" y="458" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="23">for the WhatsApp-first AI deal engine.</text>
      <rect x="58" y="522" width="188" height="44" rx="22" fill="#7c3aed" fill-opacity="0.16" stroke="#d8b4fe" stroke-opacity="0.55"/>
      <text x="152" y="550" text-anchor="middle" fill="#f3e8ff" font-family="Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(heldFor)}</text>
      <text x="270" y="550" fill="#94a3b8" font-family="Arial, sans-serif" font-size="16">${escapeXml(availability)}</text>
    </svg>`;
}
