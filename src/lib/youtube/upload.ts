import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  isAuthError,
  refreshAccessToken,
  uploadVideo,
} from '@/lib/youtube/client';

/** Queued on the 'listing-videos' Redis list alongside ListingVideoJob;
 *  the queue worker branches on `kind`. */
export interface YouTubeUploadJob {
  kind: 'youtube_upload';
  propertyId: string;
  accountId: string;
}

interface VideoMetadataFacts {
  title?: string | null;
  city?: string | null;
  sublocality?: string | null;
  location?: string | null;
}

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;

/** YouTube rejects '<' and '>' in titles/descriptions and caps their
 *  lengths. Pure — exported for tests. */
export function buildVideoMetadata(
  property: VideoMetadataFacts,
  brand: string
): { title: string; description: string } {
  const clean = (s: string) =>
    s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  const locality =
    [property.sublocality, property.city].filter(Boolean).join(', ') ||
    property.location ||
    '';
  const title = clean(
    [property.title || 'Property listing', locality].filter(Boolean).join(' · ')
  ).slice(0, TITLE_MAX);
  const description = [
    locality && `Location: ${clean(locality)}`,
    `Listed by ${clean(brand)}.`,
    'Reply on WhatsApp to book a site visit.',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, DESCRIPTION_MAX);
  return { title, description };
}

/**
 * Uploads a property's rendered listing video to the account's
 * connected YouTube channel as Unlisted and stamps the result onto the
 * property row (youtube_status: uploading → ready | failed).
 *
 * Never throws — operational failures land in youtube_status='failed'
 * so a post-render auto-upload can never mark a successful video
 * render as failed. Pass `videoBytes` when the MP4 is already on disk
 * (the render worker does) to skip re-downloading from storage.
 */
export async function syncPropertyVideoToYouTube(opts: {
  propertyId: string;
  accountId: string;
  videoBytes?: Buffer;
}): Promise<void> {
  const admin = supabaseAdmin();

  const markFailed = async (message: string) => {
    await admin
      .from('properties')
      .update({
        youtube_status: 'failed',
        youtube_error: message.slice(0, 500),
      })
      .eq('id', opts.propertyId)
      .eq('account_id', opts.accountId);
  };

  try {
    const { data: config } = await admin
      .from('youtube_config')
      .select('refresh_token, status')
      .eq('account_id', opts.accountId)
      .maybeSingle();
    if (!config || config.status !== 'connected') {
      await markFailed(
        'No connected YouTube channel — connect one in Settings → Showcase.'
      );
      return;
    }

    const { data: property } = await admin
      .from('properties')
      .select('id, title, city, sublocality, location, video_url, video_status')
      .eq('id', opts.propertyId)
      .eq('account_id', opts.accountId)
      .maybeSingle();
    if (!property || property.video_status !== 'ready' || !property.video_url) {
      await markFailed('The listing video is not ready to upload.');
      return;
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      await markFailed('YouTube is not configured on this server.');
      return;
    }

    await admin
      .from('properties')
      .update({ youtube_status: 'uploading', youtube_error: null })
      .eq('id', property.id);

    let accessToken: string;
    try {
      const token = await refreshAccessToken({
        refreshToken: decrypt(config.refresh_token),
        clientId,
        clientSecret,
      });
      accessToken = token.access_token;
    } catch (err) {
      if (isAuthError(err)) {
        await admin
          .from('youtube_config')
          .update({
            status: 'token_expired',
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', opts.accountId);
        await markFailed(
          'YouTube connection expired — reconnect in Settings → Showcase.'
        );
        return;
      }
      throw err;
    }

    let bytes = opts.videoBytes;
    if (!bytes) {
      const res = await fetch(property.video_url);
      if (!res.ok) {
        await markFailed(`Video download failed (HTTP ${res.status}).`);
        return;
      }
      bytes = Buffer.from(await res.arrayBuffer());
    }

    const { data: account } = await admin
      .from('accounts')
      .select('name')
      .eq('id', opts.accountId)
      .maybeSingle();
    const { title, description } = buildVideoMetadata(
      property,
      account?.name || 'ConvoReal'
    );

    const videoId = await uploadVideo({
      accessToken,
      bytes,
      title,
      description,
    });

    await admin
      .from('properties')
      .update({
        youtube_video_id: videoId,
        youtube_status: 'ready',
        youtube_error: null,
        youtube_uploaded_at: new Date().toISOString(),
      })
      .eq('id', property.id);
    console.log(
      `[youtube-upload] ready: property=${property.id} video=${videoId}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[youtube-upload] failed:', message);
    await markFailed(message).catch((dbErr) =>
      console.error('[youtube-upload] failed to record failure:', dbErr)
    );
  }
}
