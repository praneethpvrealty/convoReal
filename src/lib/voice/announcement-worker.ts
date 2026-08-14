import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { chunkNarration } from '@/lib/video/listing-video-worker';
import type { NarrationLanguage } from '@/lib/video/listing-video';

/**
 * Renders a voice_announcements row to a WhatsApp-ready voice note on
 * the queue worker — the only place Sarvam TTS and ffmpeg run (same
 * constraint as listing videos). WAV from Sarvam is transcoded to
 * ogg/opus because Meta rejects wav and renders ogg/opus as a
 * push-to-talk bubble, then uploaded to the public `announcements`
 * bucket, where sendMediaMessage's link points at send time.
 *
 * Operational failures land in status='failed' with the generation
 * charge refunded — callers never pay for a note that never existed.
 */

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FONT =
  process.env.VIDEO_FONT_PATH ||
  '/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const SARVAM_API_BASE = process.env.SARVAM_API_BASE || 'https://api.sarvam.ai';

export interface AnnouncementAudioJob {
  kind: 'announcement_audio';
  announcementId: string;
  accountId: string;
}

const run = (bin: string, args: string[]) =>
  execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

async function sarvamPost(
  pathname: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SARVAM_API_BASE}${pathname}`, {
    method: 'POST',
    headers: {
      'api-subscription-key': SARVAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `Sarvam ${pathname} → HTTP ${res.status}: ${raw.slice(0, 500)}`
    );
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

async function speechWav(
  english: string,
  language: NarrationLanguage,
  workDir: string
): Promise<string> {
  const out = path.join(workDir, 'announcement.wav');
  if (!SARVAM_API_KEY) {
    console.warn(
      '[announcement-audio] SARVAM_API_KEY not set — espeak-ng placeholder voice (English only).'
    );
    run('espeak-ng', [
      '-v',
      'en-us+f3',
      '-s',
      '150',
      '-p',
      '40',
      '-a',
      '190',
      '-w',
      out,
      english,
    ]);
    return out;
  }
  let text = english;
  if (language !== 'en-IN') {
    const t = await sarvamPost('/translate', {
      input: english,
      source_language_code: 'en-IN',
      target_language_code: language,
      model: 'mayura:v1',
    });
    if (typeof t.translated_text !== 'string' || !t.translated_text.trim()) {
      throw new Error(
        `Sarvam /translate returned no translated_text: ${JSON.stringify(t).slice(0, 300)}`
      );
    }
    text = t.translated_text;
  }
  const chunks = chunkNarration(text);
  const files: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const data = await sarvamPost('/text-to-speech', {
      inputs: [chunks[i]],
      target_language_code: language,
      speaker: process.env.SARVAM_SPEAKER || 'anushka',
      model: 'bulbul:v2',
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    });
    const b64 = Array.isArray(data.audios) ? (data.audios[0] as string) : null;
    if (!b64) {
      throw new Error(
        `Sarvam /text-to-speech returned no audios[0]: ${JSON.stringify(data).slice(0, 300)}`
      );
    }
    const f = path.join(workDir, `tts-${i}.wav`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    files.push(f);
  }
  if (files.length === 1) {
    fs.copyFileSync(files[0], out);
  } else {
    const list = path.join(workDir, 'tts-list.txt');
    fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
    run(FFMPEG, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c',
      'copy',
      out,
    ]);
  }
  return out;
}

/** English text → WhatsApp-ready ogg/opus voice note in workDir.
 *  Shared by announcements and per-reminder audio jobs. */
export async function synthesizeVoiceNoteOgg(
  englishText: string,
  language: NarrationLanguage,
  workDir: string
): Promise<string> {
  const wav = await speechWav(englishText, language, workDir);
  const ogg = path.join(workDir, 'note.ogg');
  run(FFMPEG, [
    '-y',
    '-i',
    wav,
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    '-ar',
    '48000',
    '-ac',
    '1',
    ogg,
  ]);
  return ogg;
}

export async function processAnnouncementAudioJob(
  job: AnnouncementAudioJob
): Promise<void> {
  const admin = supabaseAdmin();
  const { data: announcement } = await admin
    .from('voice_announcements')
    .select('id, account_id, title, body_text, language, status')
    .eq('id', job.announcementId)
    .eq('account_id', job.accountId)
    .maybeSingle();
  if (!announcement) {
    console.warn(
      `[announcement-audio] Announcement ${job.announcementId} not found — skipping.`
    );
    return;
  }
  if (announcement.status === 'ready') return;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'announcement-'));
  try {
    const ogg = await synthesizeVoiceNoteOgg(
      announcement.body_text,
      announcement.language as NarrationLanguage,
      workDir
    );

    const storagePath = `${announcement.account_id}/${announcement.id}.ogg`;
    const bytes = fs.readFileSync(ogg);
    const { error: upErr } = await admin.storage
      .from('announcements')
      .upload(storagePath, bytes, { contentType: 'audio/ogg', upsert: true });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
    const { data: pub } = admin.storage
      .from('announcements')
      .getPublicUrl(storagePath);

    // The same narration packaged as an mp4 (branded still + audio) so
    // a VIDEO-header template can carry it to contacts outside the
    // 24-hour window — Meta has no audio template format. Best-effort:
    // an announcement without a video is still ready, just window-bound.
    let videoUrl: string | null = null;
    try {
      const titleFile = path.join(workDir, 'title.txt');
      fs.writeFileSync(titleFile, announcement.title || 'Announcement');
      const card = path.join(workDir, 'card.png');
      run(FFMPEG, [
        '-f',
        'lavfi',
        '-i',
        'color=c=0x0f172a:s=720x720',
        '-vf',
        `drawtext=fontfile=${FONT}:textfile=${titleFile}:fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2`,
        '-frames:v',
        '1',
        '-y',
        card,
      ]);
      const mp4 = path.join(workDir, 'announcement.mp4');
      run(FFMPEG, [
        '-loop',
        '1',
        '-i',
        card,
        '-i',
        ogg,
        '-c:v',
        'libx264',
        '-tune',
        'stillimage',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-shortest',
        '-movflags',
        '+faststart',
        '-y',
        mp4,
      ]);
      const videoPath = `${announcement.account_id}/${announcement.id}.mp4`;
      const { error: vidErr } = await admin.storage
        .from('announcements')
        .upload(videoPath, fs.readFileSync(mp4), {
          contentType: 'video/mp4',
          upsert: true,
        });
      if (vidErr) throw new Error(vidErr.message);
      videoUrl = admin.storage.from('announcements').getPublicUrl(videoPath)
        .data.publicUrl;
    } catch (videoErr) {
      console.warn(
        `[announcement-audio] Video packaging failed for ${announcement.id} (voice note still ready):`,
        videoErr instanceof Error ? videoErr.message : videoErr
      );
    }

    await admin
      .from('voice_announcements')
      .update({
        status: 'ready',
        audio_url: pub.publicUrl,
        video_url: videoUrl,
        error: null,
      })
      .eq('id', announcement.id)
      .select('id');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[announcement-audio] Generation failed for ${announcement.id}:`,
      message
    );
    await admin
      .from('voice_announcements')
      .update({ status: 'failed', error: message.slice(0, 500) })
      .eq('id', announcement.id)
      .select('id');
    await refundCredits(
      announcement.account_id,
      'audio_announcement',
      AI_FEATURE_COSTS.audio_announcement,
      {
        description: `audio_announcement generation refund (${announcement.id})`,
      }
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
