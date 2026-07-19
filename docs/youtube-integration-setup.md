# YouTube Auto-Upload — Setup Guide

Generated listing videos can be auto-uploaded to each account's own
YouTube channel as **Unlisted** videos. YouTube then hosts and streams
them for free (with adaptive quality on poor connections), and the
public Showcase embeds the video next to the listing photos. The
≤16MB MP4 in Supabase storage is kept as-is for direct WhatsApp video
messages and as the embed fallback.

This is a one-time server-side setup (a Google Cloud OAuth app),
after which every account owner connects their own channel from
**Settings → Showcase → YouTube Channel** — the same per-account model
as the WhatsApp and Meta Ads connections.

## How it works

```text
Property form ── "Generate video" ──▶ Redis 'listing-videos' ──▶ Queue worker
                                                                    │ renders MP4 (ffmpeg)
                                                                    │ uploads to property-videos bucket
                                                                    │ video_status = ready
                                                                    ▼
                                              youtube_config connected + auto_upload?
                                                                    │
                                                                    │ refresh token → access token
                                                                    │ resumable upload (Unlisted)
                                                                    ▼
                                              properties.youtube_video_id / youtube_status
                                                                    │
                        Showcase embeds https://www.youtube-nocookie.com/embed/<id>
```

- The OAuth **refresh token** is stored AES-256-GCM encrypted in
  `youtube_config.refresh_token` (migration 153), exactly like the
  WhatsApp and Meta Ads tokens. Access tokens are minted per upload
  and never stored.
- `youtube_config` has RLS enabled with **no policies** — only the
  service-role client (API routes + queue worker) can touch it.
- Uploads run in the queue worker (`npm run worker`), never in
  Vercel functions, so `REDIS_URL` and the worker deployment are
  required for this feature.
- A manual **Upload to YouTube** button on the property form covers
  videos generated before the channel was connected (or with
  auto-upload switched off).
- **WhatsApp intake**: a walkthrough video (MP4, ≤16MB) forwarded to
  the owner chatbot alongside the listing photos/details is attached
  to the draft, becomes `properties.video_url` on confirm, and is
  queued for the same unlisted YouTube upload automatically.

## 1. Create the Google Cloud OAuth app

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
   and create a project (e.g. `convoreal-youtube`).
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in app name, support email, and developer contact.
   - Scopes: add
     `https://www.googleapis.com/auth/youtube.upload` and
     `https://www.googleapis.com/auth/youtube.readonly`.
4. **APIs & Services → Credentials → Create credentials →
   OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI (exact string match):

     ```text
     https://<your-domain>/api/youtube/oauth/callback
     ```

     This must match `${NEXT_PUBLIC_APP_URL || NEXT_PUBLIC_SITE_URL}`
     exactly, including the www/non-www form — register both forms if
     unsure (same caveat as the Meta OAuth redirect URI). Add
     `http://localhost:3000/api/youtube/oauth/callback` for local dev.

5. Copy the client ID and secret into `.env.local` (and the Vercel +
   worker environments):

   ```bash
   GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxx
   ```

   The **queue worker** needs both variables too — that's where the
   uploads actually run.

6. Run migration `supabase/migrations/153_youtube_config.sql` (SQL
   Editor or your usual migration flow).

## 2. Publish the app (do not skip)

While the consent screen's publishing status is **Testing**:

- Only listed test users can connect, and
- **refresh tokens expire after 7 days** — connections silently die
  weekly. Fine for a first smoke test, useless in production.

Set the publishing status to **In production** (OAuth consent screen →
Publish app). The `youtube.upload` scope is a _sensitive_ scope, so
Google will ask for verification:

- **Unverified but published**: the app works, but the consent dialog
  shows an "unverified app" warning and Google caps the app at 100
  total users. Acceptable for a pilot.
- **Verification** (Google's review, typically days to a few weeks —
  similar dance to Meta app review): removes the warning and the user
  cap. You'll need a homepage, a privacy policy URL, and a short
  demo video of the OAuth flow. Start this early.

## 3. Quota

The YouTube Data API grants **10,000 quota units/day** per project by
default, and each upload (`videos.insert`) costs **1,600 units** —
i.e. **~6 uploads/day across all connected accounts** until you
request more. Fine for a pilot; for real usage, apply for a quota
increase early via the
[YouTube API quota audit form](https://support.google.com/youtube/contact/yt_api_form)
(this is separate from OAuth verification).

When the daily quota is exhausted, uploads fail with
`quotaExceeded` — the property's `youtube_status` becomes `failed`
with the error stored in `youtube_error`, and the agent can hit
**Retry upload** the next day. The generated MP4 and the Showcase
fallback are unaffected.

## 4. Connecting a channel (per account)

1. The account **owner** opens **Settings → Showcase** and clicks
   **Connect YouTube** in the YouTube Channel card.
2. They sign in with the Google account that owns their channel and
   approve the two scopes. (Accounts without a YouTube channel get a
   "no channel" error — create one at youtube.com first.)
3. Done. **Auto-upload new listing videos** is on by default and can
   be toggled per account; uploads land on _their_ channel as
   Unlisted — visible via link/embed, never in the channel's public
   feed, subscriber notifications, or search.

Disconnecting (Settings → Showcase → Disconnect) revokes the token
with Google and stops future uploads; videos already on the channel
stay there and remain embedded until regenerated.

## Reference

| Piece                       | Where                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| Schema                      | `supabase/migrations/153_youtube_config.sql`                           |
| Google/YouTube API client   | `src/lib/youtube/client.ts`                                            |
| Upload orchestration        | `src/lib/youtube/upload.ts`                                            |
| OAuth routes                | `src/app/api/youtube/oauth/{start,callback}/route.ts`                  |
| Status / auto-upload toggle | `src/app/api/youtube/config/route.ts`                                  |
| Disconnect                  | `src/app/api/youtube/disconnect/route.ts`                              |
| Manual upload               | `src/app/api/properties/[id]/youtube-upload/route.ts`                  |
| Worker hook                 | `src/lib/video/listing-video-worker.ts`, `src/scripts/queue-worker.ts` |
| Settings UI                 | `src/components/settings/youtube-connect-card.tsx`                     |
| Showcase embed              | `src/components/showcase/showcase-view.tsx`                            |
