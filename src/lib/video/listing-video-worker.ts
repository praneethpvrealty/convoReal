// ============================================================
// Listing-video render + job processing — WORKER ONLY.
//
// Runs inside the queue worker container (Dockerfile.worker installs
// ffmpeg / espeak-ng / DejaVu fonts). Never import from Next.js
// routes — Vercel functions have no ffmpeg.
//
// Job flow (queued by POST /api/properties/[id]/generate-video):
//   1. load property, mark video_status=processing
//   2. download up to 5 listing photos to a temp dir
//   3. narration script (template) → Sarvam translate (regional) →
//      Sarvam TTS (bulbul), espeak-ng fallback without a key
//   4. ffmpeg: Ken Burns segments + captions + end card + ducked
//      music → 720x1280 MP4 (≈2-3MB, WhatsApp-ready)
//   5. upload to property-images bucket under videos/, set
//      video_status=ready + video_url
//   on any failure: video_status=failed + video_error + credit refund
// ============================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { refundCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import {
  buildCaptions,
  buildNarrationScript,
  isNarrationLanguage,
  type NarrationLanguage,
} from './listing-video';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FONT =
  process.env.VIDEO_FONT_PATH ||
  '/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const SARVAM_API_BASE = process.env.SARVAM_API_BASE || 'https://api.sarvam.ai';

const SEG_SECONDS = 6;
const FPS = 30;
const W = 720;
const H = 1280;
const MAX_PHOTOS = 5;

export interface ListingVideoJob {
  kind: 'listing_video';
  propertyId: string;
  accountId: string;
  language: NarrationLanguage;
  requestedBy: string | null;
}

const run = (bin: string, args: string[]) =>
  execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

/** Split narration on sentence boundaries into ≤max-char chunks
 *  (Sarvam caps text per request). Exported for tests. */
export function chunkNarration(text: string, max = 450): string[] {
  const sentences =
    text.replace(/\s+/g, ' ').trim().match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function sarvamPost(pathname: string, body: unknown): Promise<Record<string, unknown>> {
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
    throw new Error(`Sarvam ${pathname} → HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

async function makeNarrationWav(
  english: string,
  language: NarrationLanguage,
  workDir: string,
): Promise<string> {
  const out = path.join(workDir, 'narration.wav');
  if (!SARVAM_API_KEY) {
    console.warn('[listing-video] SARVAM_API_KEY not set — espeak-ng placeholder voice (English only).');
    run('espeak-ng', ['-v', 'en-us+f3', '-s', '150', '-p', '40', '-a', '190', '-w', out, english]);
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
      throw new Error(`Sarvam /translate returned no translated_text: ${JSON.stringify(t).slice(0, 300)}`);
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
    if (!b64) throw new Error(`Sarvam /text-to-speech returned no audios[0]: ${JSON.stringify(data).slice(0, 300)}`);
    const f = path.join(workDir, `tts-${i}.wav`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    files.push(f);
  }
  if (files.length === 1) {
    fs.copyFileSync(files[0], out);
  } else {
    const list = path.join(workDir, 'tts-list.txt');
    fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
    run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  }
  return out;
}

/** Gentle additive pad written straight to WAV — stands in for a
 *  licensed music library. */
function makeMusicWav(workDir: string, seconds: number): string {
  const out = path.join(workDir, 'music.wav');
  const sr = 44100;
  const n = sr * seconds;
  const chords = [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 261.63, 349.23, 440.0],
    [196.0, 246.94, 293.66, 392.0],
  ];
  const chordLen = sr * 5;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const chord = chords[Math.floor(i / chordLen) % chords.length];
    const tIn = (i % chordLen) / chordLen;
    const env = Math.min(tIn / 0.25, (1 - tIn) / 0.25, 1);
    const shimmer = 0.85 + 0.15 * Math.sin((2 * Math.PI * 0.13 * i) / sr);
    let s = 0;
    for (const f of chord) {
      s += Math.sin((2 * Math.PI * f * i) / sr) + 0.35 * Math.sin((2 * Math.PI * (f / 2) * i) / sr);
    }
    pcm[i] = Math.round(2600 * env * shimmer * (s / chord.length));
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + n * 2, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(out, Buffer.concat([header, Buffer.from(pcm.buffer)]));
  return out;
}

const escText = (t: string) =>
  t.replace(/\\/g, '\\\\').replace(/'/g, "\\\\\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');

function renderVideo(opts: {
  photoFiles: string[];
  captions: string[];
  narrationWav: string;
  musicWav: string;
  brand: string;
  endCard: { line1: string; line2: string; cta: string };
  outPath: string;
  workDir: string;
}): void {
  const { photoFiles, captions, narrationWav, musicWav, brand, endCard, outPath, workDir } = opts;
  const segments: string[] = [];
  photoFiles.forEach((file, i) => {
    const seg = path.join(workDir, `seg${i}.mp4`);
    const frames = SEG_SECONDS * FPS;
    const zoom = i % 2 === 0 ? `1.02+0.12*on/${frames}` : `1.14-0.12*on/${frames}`;
    const vf = [
      `crop='min(iw,ih*${W}/${H})':'min(ih,iw*${H}/${W})'`,
      `scale=${W * 2}:${H * 2}`,
      `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)+((on/${frames})-0.5)*40':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
      `drawtext=fontfile=${FONT}:text='${escText(captions[i] ?? '')}':fontsize=30:fontcolor=white:box=1:boxcolor=0x0b1220@0.72:boxborderw=16:x=(w-text_w)/2:y=h-260`,
      `drawtext=fontfile=${FONT}:text='${escText(brand)}':fontsize=26:fontcolor=white@0.9:box=1:boxcolor=0x0b1220@0.5:boxborderw=12:x=36:y=48`,
      `format=yuv420p`,
    ].join(',');
    run(FFMPEG, ['-y', '-loop', '1', '-i', file, '-vf', vf, '-t', String(SEG_SECONDS),
      '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', seg]);
    segments.push(seg);
  });

  const end = path.join(workDir, `seg${photoFiles.length}.mp4`);
  const endVf = [
    `drawtext=fontfile=${FONT}:text='${escText(endCard.line1)}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=460`,
    `drawtext=fontfile=${FONT}:text='${escText(endCard.line2)}':fontsize=30:fontcolor=0x9be8c5:x=(w-text_w)/2:y=560`,
    `drawtext=fontfile=${FONT}:text='${escText(endCard.cta)}':fontsize=27:fontcolor=white:box=1:boxcolor=0x1d9e6b@0.95:boxborderw=20:x=(w-text_w)/2:y=700`,
    `drawtext=fontfile=${FONT}:text='Made with ConvoReal':fontsize=22:fontcolor=white@0.45:x=(w-text_w)/2:y=1160`,
    `format=yuv420p`,
  ].join(',');
  run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `color=c=0x0b1220:s=${W}x${H}:r=${FPS}`,
    '-vf', endVf, '-t', '5', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', end]);
  segments.push(end);

  const list = path.join(workDir, 'list.txt');
  fs.writeFileSync(list, segments.map((s) => `file '${s}'`).join('\n'));
  const silent = path.join(workDir, 'video.mp4');
  run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);

  const total = photoFiles.length * SEG_SECONDS + 5;
  run(FFMPEG, ['-y', '-i', silent, '-i', musicWav, '-i', narrationWav,
    '-filter_complex',
    '[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=1000|1000,volume=1.6,apad,asplit=2[voiceA][voiceB];' +
    '[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.45[bed];' +
    '[bed][voiceA]sidechaincompress=threshold=0.04:ratio=8:attack=120:release=800[ducked];' +
    `[ducked][voiceB]amix=inputs=2:duration=first:dropout_transition=2,afade=t=out:st=${total - 2}:d=2[a]`,
    '-map', '0:v', '-map', '[a]', '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', outPath]);
}

/** Process one queued job end-to-end. Throws only on programmer
 *  error — operational failures land in video_status='failed'. */
export async function processListingVideoJob(job: ListingVideoJob): Promise<void> {
  const admin = supabaseAdmin();
  const { data: property, error } = await admin
    .from('properties')
    .select('id, account_id, title, type, bedrooms, city, sublocality, location, price, rent_per_month, listing_type, images, video_language')
    .eq('id', job.propertyId)
    .eq('account_id', job.accountId)
    .maybeSingle();
  if (error || !property) {
    console.error('[listing-video] property not found for job', job.propertyId, error?.message);
    return;
  }
  const language: NarrationLanguage = isNarrationLanguage(job.language) ? job.language : 'en-IN';
  await admin.from('properties').update({ video_status: 'processing', video_error: null }).eq('id', property.id);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-video-'));
  try {
    const photoUrls = (property.images ?? []).filter((u: string) => u?.trim()).slice(0, MAX_PHOTOS);
    if (photoUrls.length === 0) throw new Error('Listing has no photos to build a video from.');
    const photoFiles: string[] = [];
    for (let i = 0; i < photoUrls.length; i++) {
      const res = await fetch(photoUrls[i]);
      if (!res.ok) throw new Error(`Photo download failed (${res.status}): ${photoUrls[i]}`);
      const f = path.join(workDir, `photo-${i}.jpg`);
      fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      photoFiles.push(f);
    }

    const { data: account } = await admin.from('accounts').select('name').eq('id', job.accountId).maybeSingle();
    const brand = account?.name || 'ConvoReal';
    const script = buildNarrationScript(property);
    const captions = buildCaptions(property, photoFiles.length);
    const narrationWav = await makeNarrationWav(script, language, workDir);
    const musicWav = makeMusicWav(workDir, photoFiles.length * SEG_SECONDS + 6);
    const outPath = path.join(workDir, 'listing.mp4');
    const locality = [property.sublocality, property.city].filter(Boolean).join(', ') || property.location || '';
    renderVideo({
      photoFiles,
      captions,
      narrationWav,
      musicWav,
      brand,
      endCard: {
        line1: (property.title || 'New Listing').slice(0, 26),
        line2: locality.slice(0, 42) || 'Full details on WhatsApp',
        cta: 'Reply on WhatsApp to book a site visit',
      },
      outPath,
      workDir,
    });

    const storagePath = `videos/${job.accountId}/${property.id}-${Date.now()}.mp4`;
    const bytes = fs.readFileSync(outPath);
    const { error: upErr } = await admin.storage
      .from('property-images')
      .upload(storagePath, bytes, { contentType: 'video/mp4', upsert: true });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
    const { data: pub } = admin.storage.from('property-images').getPublicUrl(storagePath);

    await admin.from('properties').update({
      video_url: pub.publicUrl,
      video_status: 'ready',
      video_language: language,
      video_error: null,
      video_generated_at: new Date().toISOString(),
    }).eq('id', property.id);
    console.log(`[listing-video] ready: property=${property.id} ${(bytes.length / 1024 / 1024).toFixed(1)}MB lang=${language}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[listing-video] job failed:', message);
    await admin.from('properties').update({ video_status: 'failed', video_error: message.slice(0, 500) }).eq('id', property.id);
    // The route charged before queueing — give the credits back on failure.
    try {
      await refundCredits(job.accountId, 'listing_video', AI_FEATURE_COSTS.listing_video);
    } catch (refundErr) {
      console.error('[listing-video] refund failed:', refundErr);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
