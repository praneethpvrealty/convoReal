#!/usr/bin/env node
// ============================================================
// Listing-video generator — PROTOTYPE
//
// photos + property facts ──► 720x1280 MP4 (≤16MB, WhatsApp-ready)
//   1. narration  : script text → TTS wav via Sarvam AI (bulbul) when
//                   SARVAM_API_KEY is set — natural Indian voices in
//                   11 languages, with optional English→regional
//                   translation via Sarvam translate (mayura).
//                   Falls back to espeak-ng (robotic placeholder)
//                   without a key so the pipeline stays runnable.
//   2. music bed  : synthesized ambient pad (production: licensed
//                   library tracks), ducked under the narration
//   3. visuals    : Ken Burns pan/zoom over each photo + caption
//                   overlays + branded end card
//
// Usage: SARVAM_API_KEY=... node generate-listing-video.mjs <config.json> <out.mp4>
// config: { photos: [{file, caption}], narration, language?, speaker?,
//           translateFromEnglish?, endCard: {line1, line2, cta},
//           musicSeconds }
// ============================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------- Sarvam AI (docs.sarvam.ai) ----------
// Auth: `api-subscription-key` header. Get a key from
// dashboard.sarvam.ai and export it as SARVAM_API_KEY (for the app
// later: Vercel + worker env var of the same name).
// SARVAM_API_BASE exists for tests/proxies; default is the real API.
const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const SARVAM_API_BASE = process.env.SARVAM_API_BASE || 'https://api.sarvam.ai';
const SARVAM_TTS_MODEL = 'bulbul:v2';

/** BCP-47 codes Sarvam bulbul narrates. The app's language picker
 *  renders from this list. */
export const NARRATION_LANGUAGES = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी (Hindi)',
  'kn-IN': 'ಕನ್ನಡ (Kannada)',
  'ta-IN': 'தமிழ் (Tamil)',
  'te-IN': 'తెలుగు (Telugu)',
  'ml-IN': 'മലയാളം (Malayalam)',
  'mr-IN': 'मराठी (Marathi)',
  'bn-IN': 'বাংলা (Bengali)',
  'gu-IN': 'ગુજરાતી (Gujarati)',
  'pa-IN': 'ਪੰਜਾਬੀ (Punjabi)',
  'od-IN': 'ଓଡ଼ିଆ (Odia)',
};

/** Split narration on sentence boundaries into ≤`max`-char chunks —
 *  Sarvam TTS caps input length per request. */
export function chunkNarration(text, max = 450) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const chunks = [];
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

async function sarvamPost(pathname, body) {
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
    // Surface the whole response — if Sarvam's contract has drifted
    // from what this prototype expects, this makes it obvious.
    throw new Error(`Sarvam ${pathname} → HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  return JSON.parse(raw);
}

/** English → regional translation (Sarvam mayura), so the app can
 *  keep generating scripts in English and still narrate regionally. */
async function sarvamTranslate(text, targetLang) {
  const data = await sarvamPost('/translate', {
    input: text,
    source_language_code: 'en-IN',
    target_language_code: targetLang,
    model: 'mayura:v1',
  });
  if (typeof data.translated_text !== 'string' || !data.translated_text.trim()) {
    throw new Error(`Sarvam /translate returned no translated_text: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.translated_text;
}

/** Narration text → WAV file via Sarvam TTS, chunked and re-joined. */
async function sarvamNarrate(text, { language, speaker, workDir, outWav, ffmpeg }) {
  const chunks = chunkNarration(text);
  const chunkFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const data = await sarvamPost('/text-to-speech', {
      inputs: [chunks[i]],
      target_language_code: language,
      speaker,
      model: SARVAM_TTS_MODEL,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    });
    const b64 = Array.isArray(data.audios) ? data.audios[0] : null;
    if (!b64) {
      throw new Error(`Sarvam /text-to-speech returned no audios[0]: ${JSON.stringify(data).slice(0, 300)}`);
    }
    const f = path.join(workDir, `tts-${i}.wav`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    chunkFiles.push(f);
    console.log(`sarvam tts chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
  }
  if (chunkFiles.length === 1) {
    fs.copyFileSync(chunkFiles[0], outWav);
  } else {
    const list = path.join(workDir, 'tts-list.txt');
    fs.writeFileSync(list, chunkFiles.map((f) => `file '${f}'`).join('\n'));
    execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', outWav],
      { stdio: ['ignore', 'ignore', 'pipe'] });
  }
}

// Production worker: `apk add ffmpeg` in Dockerfile.worker puts it on
// PATH; override with FFMPEG_PATH for local experiments.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const [configPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const work = fs.mkdtempSync('/tmp/listing-video-');
const SEG_SECONDS = 6;
const FPS = 30;
const W = 720, H = 1280;

const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

// ---------- 1. Narration ----------
const narrationWav = path.join(work, 'narration.wav');
const language = cfg.language || 'en-IN';
if (!NARRATION_LANGUAGES[language]) {
  throw new Error(
    `Unsupported narration language "${language}". Supported: ${Object.keys(NARRATION_LANGUAGES).join(', ')}`,
  );
}
if (SARVAM_API_KEY) {
  let text = cfg.narration;
  // The app generates scripts in English; regional narration can either
  // ask Gemini for the target language directly or translate here.
  if (cfg.translateFromEnglish && language !== 'en-IN') {
    text = await sarvamTranslate(text, language);
    console.log(`translated narration → ${language}: ${text.slice(0, 80)}…`);
  }
  await sarvamNarrate(text, {
    language,
    speaker: cfg.speaker || 'anushka',
    workDir: work,
    outWav: narrationWav,
    ffmpeg: FFMPEG,
  });
  console.log(`narration: Sarvam ${SARVAM_TTS_MODEL}, ${NARRATION_LANGUAGES[language]}, speaker=${cfg.speaker || 'anushka'}`);
} else {
  console.warn('SARVAM_API_KEY not set — falling back to espeak-ng placeholder voice (robotic, English only).');
  run('espeak-ng', ['-v', 'en-us+f3', '-s', '150', '-p', '40', '-a', '190',
    '-w', narrationWav, cfg.narration]);
}

// ---------- 2. Music bed: gentle additive pad, written as WAV ----------
const musicWav = path.join(work, 'music.wav');
{
  const sr = 44100;
  const seconds = cfg.musicSeconds ?? 40;
  const n = sr * seconds;
  // Cmaj7 -> Am7 -> Fmaj7 -> G6, 4 bars looped. Frequencies in Hz.
  const chords = [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 261.63, 349.23, 440.0],
    [196.0, 246.94, 293.66, 392.0],
  ];
  const chordLen = sr * 5; // 5s per chord
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const chord = chords[Math.floor(i / chordLen) % chords.length];
    const tIn = (i % chordLen) / chordLen; // 0..1 within chord
    // Soft attack/release envelope per chord + slow global shimmer.
    const env = Math.min(tIn / 0.25, (1 - tIn) / 0.25, 1);
    const shimmer = 0.85 + 0.15 * Math.sin((2 * Math.PI * 0.13 * i) / sr);
    let s = 0;
    for (const f of chord) {
      s += Math.sin((2 * Math.PI * f * i) / sr);
      s += 0.35 * Math.sin((2 * Math.PI * (f / 2) * i) / sr); // sub octave
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
  fs.writeFileSync(musicWav, Buffer.concat([header, Buffer.from(pcm.buffer)]));
}

// ---------- 3. Per-photo Ken Burns segments with captions ----------
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\\\\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
const segments = [];
cfg.photos.forEach((p, i) => {
  const seg = path.join(work, `seg${i}.mp4`);
  const frames = SEG_SECONDS * FPS;
  // Alternate zoom-in / zoom-out with a slow drift so stills feel alive.
  const zoom = i % 2 === 0
    ? `1.02+0.12*on/${frames}`
    : `1.14-0.12*on/${frames}`;
  const caption = esc(p.caption);
  const vf = [
    // Orientation-safe: center-crop to the video's 9:16 aspect first
    // (no-op for photos already 9:16), so landscape shots become a
    // clean vertical slice instead of getting stretched.
    `crop='min(iw,ih*${W}/${H})':'min(ih,iw*${H}/${W})'`,
    `scale=${W * 2}:${H * 2}`,
    `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)+((on/${frames})-0.5)*40':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    // Caption pill near the bottom.
    `drawtext=fontfile=${FONT}:text='${caption}':fontsize=30:fontcolor=white:box=1:boxcolor=0x0b1220@0.72:boxborderw=16:x=(w-text_w)/2:y=h-260`,
    // Small brand tag top-left.
    `drawtext=fontfile=${FONT}:text='PV Realty':fontsize=26:fontcolor=white@0.9:box=1:boxcolor=0x0b1220@0.5:boxborderw=12:x=36:y=48`,
    `format=yuv420p`,
  ].join(',');
  run(FFMPEG, ['-y', '-loop', '1', '-i', p.file, '-vf', vf, '-t', String(SEG_SECONDS),
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', seg]);
  segments.push(seg);
  console.log(`segment ${i + 1}/${cfg.photos.length} done`);
});

// ---------- 4. Branded end card ----------
{
  const seg = path.join(work, `seg${cfg.photos.length}.mp4`);
  const e = cfg.endCard;
  const vf = [
    `drawtext=fontfile=${FONT}:text='${esc(e.line1)}':fontsize=56:fontcolor=white:x=(w-text_w)/2:y=460`,
    `drawtext=fontfile=${FONT}:text='${esc(e.line2)}':fontsize=32:fontcolor=0x9be8c5:x=(w-text_w)/2:y=560`,
    `drawtext=fontfile=${FONT}:text='${esc(e.cta)}':fontsize=27:fontcolor=white:box=1:boxcolor=0x1d9e6b@0.95:boxborderw=20:x=(w-text_w)/2:y=700`,
    `drawtext=fontfile=${FONT}:text='Made with ConvoReal':fontsize=22:fontcolor=white@0.45:x=(w-text_w)/2:y=1160`,
    `format=yuv420p`,
  ].join(',');
  run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `color=c=0x0b1220:s=${W}x${H}:r=${FPS}`,
    '-vf', vf, '-t', '5', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', seg]);
  segments.push(seg);
  console.log('end card done');
}

// ---------- 5. Concat + audio mix (music ducked under narration) ----------
const listFile = path.join(work, 'list.txt');
fs.writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));
const silent = path.join(work, 'video.mp4');
run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);

run(FFMPEG, ['-y', '-i', silent, '-i', musicWav, '-i', narrationWav,
  '-filter_complex',
  // Narration starts after 1s; music sits under it via sidechain ducking,
  // then everything fades out with the video.
  // sidechaincompress needs both inputs in one format — normalize to
  // 44.1kHz stereo float before anything else.
  '[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=1000|1000,volume=1.6,apad,asplit=2[voiceA][voiceB];' +
  '[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.45[bed];' +
  '[bed][voiceA]sidechaincompress=threshold=0.04:ratio=8:attack=120:release=800[ducked];' +
  '[ducked][voiceB]amix=inputs=2:duration=first:dropout_transition=2,afade=t=out:st=33:d=2[a]',
  '-map', '0:v', '-map', '[a]', '-shortest',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', outPath]);

const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
console.log(`\nDone: ${outPath} (${mb} MB)`);
fs.rmSync(work, { recursive: true, force: true });
