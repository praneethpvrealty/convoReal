#!/usr/bin/env node
// ============================================================
// Listing-video generator — PROTOTYPE
//
// photos + property facts ──► 720x1280 MP4 (≤16MB, WhatsApp-ready)
//   1. narration  : script text → TTS wav (espeak-ng placeholder here;
//                   production swaps in Google Cloud TTS / Sarvam for
//                   natural English/Hindi/Kannada voices, ~₹1-4/video)
//   2. music bed  : synthesized ambient pad (production: licensed
//                   library tracks), ducked under the narration
//   3. visuals    : Ken Burns pan/zoom over each photo + caption
//                   overlays + branded end card
//
// Usage: node generate-listing-video.mjs <config.json> <out.mp4>
// config: { photos: [{file, caption}], narration, endCard: {line1,
//           line2, cta}, musicSeconds }
// ============================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

// ---------- 1. Narration (placeholder TTS) ----------
const narrationWav = path.join(work, 'narration.wav');
run('espeak-ng', ['-v', 'en-us+f3', '-s', '150', '-p', '40', '-a', '190',
  '-w', narrationWav, cfg.narration]);

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
    `scale=${W * 2}:-1`,
    `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)+((on/${frames})-0.5)*40':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    // Caption pill near the bottom.
    `drawtext=fontfile=${FONT}:text='${caption}':fontsize=40:fontcolor=white:box=1:boxcolor=0x0b1220@0.72:boxborderw=22:x=(w-text_w)/2:y=h-260`,
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
