import { describe, expect, it } from 'vitest';
import { readCopilotVoiceRequest } from './voice';

describe('Copilot voice request', () => {
  const recording = Buffer.alloc(300, 1).toString('base64');

  it('accepts the formats recorded by web and Expo', () => {
    expect(
      readCopilotVoiceRequest({
        audio: { base64: recording, mimeType: 'audio/webm;codecs=opus' },
      })
    ).toMatchObject({ mimeType: 'audio/webm' });
    expect(
      readCopilotVoiceRequest({
        audio: { base64: recording, mimeType: 'audio/mp4' },
      })
    ).toMatchObject({ mimeType: 'audio/mp4' });
  });

  it('rejects missing, malformed, tiny, and unsupported audio', () => {
    expect(readCopilotVoiceRequest({})).toMatchObject({ status: 400 });
    expect(
      readCopilotVoiceRequest({
        audio: { base64: '**not-base64**', mimeType: 'audio/mp4' },
      })
    ).toMatchObject({ status: 400 });
    expect(
      readCopilotVoiceRequest({
        audio: {
          base64: Buffer.alloc(20).toString('base64'),
          mimeType: 'audio/mp4',
        },
      })
    ).toMatchObject({ status: 422 });
    expect(
      readCopilotVoiceRequest({
        audio: { base64: recording, mimeType: 'video/mp4' },
      })
    ).toMatchObject({ status: 415 });
  });
});
