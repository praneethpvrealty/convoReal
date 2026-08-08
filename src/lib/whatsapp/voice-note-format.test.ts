import { describe, expect, it } from 'vitest';

import { mediaKindForMime } from '@/lib/whatsapp/media-kinds';
import {
  VOICE_NOTE_MIME_PREFERENCE,
  pickVoiceNoteMime,
  voiceNoteFilename,
} from '@/lib/whatsapp/voice-note-format';

/** What each engine's MediaRecorder.isTypeSupported answers. */
const CHROME = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4'];
const OLD_CHROME = ['audio/webm', 'audio/webm;codecs=opus'];
const FIREFOX = ['audio/ogg', 'audio/ogg;codecs=opus', 'audio/webm'];
const SAFARI = ['audio/mp4'];

const supports = (list: string[]) => (type: string) => list.includes(type);

describe('pickVoiceNoteMime', () => {
  it('never picks webm, which WhatsApp refuses', () => {
    expect(pickVoiceNoteMime(supports(CHROME))).toBe('audio/mp4');
  });

  it('prefers opus in ogg where the browser records it', () => {
    expect(pickVoiceNoteMime(supports(FIREFOX))).toBe('audio/ogg;codecs=opus');
  });

  it('falls back to mp4 on Safari', () => {
    expect(pickVoiceNoteMime(supports(SAFARI))).toBe('audio/mp4');
  });

  it('returns null rather than a container the send would reject', () => {
    expect(pickVoiceNoteMime(supports(OLD_CHROME))).toBeNull();
  });

  it('offers only types the upload route accepts as audio', () => {
    for (const type of VOICE_NOTE_MIME_PREFERENCE) {
      expect(mediaKindForMime(type)).toBe('audio');
    }
  });
});

describe('voiceNoteFilename', () => {
  it('names the file for the container it actually is', () => {
    expect(voiceNoteFilename('audio/ogg;codecs=opus', 1)).toBe('voice-1.ogg');
    expect(voiceNoteFilename('audio/mp4', 2)).toBe('voice-2.m4a');
    expect(voiceNoteFilename('audio/aac', 3)).toBe('voice-3.aac');
    expect(voiceNoteFilename('audio/mpeg', 4)).toBe('voice-4.mp3');
  });
});
