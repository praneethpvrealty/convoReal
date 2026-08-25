import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

import { getBetaInvitePreview } from '@/lib/beta/invite-preview';
import {
  betaInviteCardSvg,
  betaInvitePreviewDetails,
} from '@/lib/beta/invite-card';

export const alt = 'A private ConvoReal beta invitation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/jpeg';
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
  const image = await sharp(background)
    .composite([{ input: Buffer.from(betaInviteCardSvg(details)) }])
    .jpeg({ quality: 82, progressive: true, chromaSubsampling: '4:2:0' })
    .toBuffer();

  return new Response(new Uint8Array(image), {
    headers: {
      'Cache-Control':
        'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'Content-Type': contentType,
    },
  });
}
