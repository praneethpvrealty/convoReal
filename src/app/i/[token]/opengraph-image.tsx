import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';

import { getBetaInvitePreview } from '@/lib/beta/invite-preview';

export const alt = 'A private ConvoReal beta invitation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function Image({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [preview, background] = await Promise.all([
    getBetaInvitePreview(token),
    readFile(new URL('./beta-invite-preview-background.jpg', import.meta.url)),
  ]);

  const recipient =
    (preview?.ok && preview.label?.trim().slice(0, 54)) || 'A seat for you';
  const inviter = preview?.inviter_name?.trim().slice(0, 42) || 'ConvoReal';
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
  const backgroundUrl = `data:image/jpeg;base64,${background.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#05040d',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <img
        alt=""
        src={backgroundUrl}
        width={size.width}
        height={size.height}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          background:
            'linear-gradient(90deg, rgba(5,4,13,0.98) 0%, rgba(5,4,13,0.9) 47%, rgba(5,4,13,0.14) 78%, rgba(5,4,13,0.05) 100%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 760,
          padding: '56px 58px 50px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #a855f7, #6d28d9)',
              boxShadow: '0 0 32px rgba(168,85,247,0.45)',
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            C
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>
              ConvoReal
            </span>
            <span
              style={{
                color: '#c4b5fd',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: 'uppercase',
              }}
            >
              Private beta invitation
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ color: '#d8b4fe', fontSize: 27, fontWeight: 700 }}>
            {recipient},
          </span>
          <span
            style={{
              maxWidth: 650,
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: -3.2,
            }}
          >
            You&apos;ve been personally invited.
          </span>
          <span
            style={{
              marginTop: 8,
              color: '#cbd5e1',
              fontSize: 23,
              lineHeight: 1.35,
            }}
          >
            A private seat reserved by {inviter} for the WhatsApp-first AI deal
            engine built for property consultants.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {days !== null ? (
            <span
              style={{
                display: 'flex',
                padding: '10px 16px',
                border: '1px solid rgba(216,180,254,0.45)',
                borderRadius: 999,
                color: '#e9d5ff',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              Held for {days} {days === 1 ? 'day' : 'days'}
            </span>
          ) : null}
          <span style={{ color: '#94a3b8', fontSize: 16 }}>
            {seatsLeft !== null
              ? `${seatsLeft} beta seats left`
              : 'Invite only'}
          </span>
        </div>
      </div>
    </div>,
    size
  );
}
