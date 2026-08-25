import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';

import { getBetaInvitePreview } from '@/lib/beta/invite-preview';
import {
  betaInviteCardSvg,
  betaInvitePreviewDetails,
} from '@/lib/beta/invite-card';

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
  const details = betaInvitePreviewDetails(preview);
  const backgroundUrl = `data:image/jpeg;base64,${background.toString('base64')}`;
  const overlayUrl = `data:image/svg+xml;base64,${Buffer.from(
    betaInviteCardSvg(details)
  ).toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#05040d',
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
      <img
        alt=""
        src={overlayUrl}
        width={size.width}
        height={size.height}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
    </div>,
    {
      ...size,
      headers: {
        'Cache-Control':
          'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
