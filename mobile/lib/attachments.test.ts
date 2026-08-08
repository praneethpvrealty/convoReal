import { describe, expect, it } from 'vitest';

import {
  attachmentFilename,
  attachmentMimeType,
  formatBytes,
  formatDuration,
} from './attachments';

describe('attachmentMimeType', () => {
  it('trusts a real type the picker reports', () => {
    expect(attachmentMimeType('image/jpeg', 'x.png')).toBe('image/jpeg');
  });

  it('strips codec parameters', () => {
    expect(attachmentMimeType('audio/ogg; codecs=opus', null)).toBe('audio/ogg');
  });

  it('falls back to the extension when Android reports a byte stream', () => {
    expect(attachmentMimeType('application/octet-stream', 'floorplan.pdf')).toBe(
      'application/pdf'
    );
  });

  it('falls back to the extension when nothing is reported', () => {
    expect(attachmentMimeType(null, 'clip.mp4')).toBe('video/mp4');
    expect(attachmentMimeType(undefined, 'note.m4a')).toBe('audio/mp4');
  });

  it('is null when neither source identifies the file', () => {
    expect(attachmentMimeType(null, 'mystery')).toBeNull();
    expect(attachmentMimeType('application/octet-stream', 'file.xyz')).toBeNull();
  });

  it('is case-insensitive about extensions', () => {
    expect(attachmentMimeType(null, 'BROCHURE.PDF')).toBe('application/pdf');
  });
});

describe('attachmentFilename', () => {
  it('prefers the name the picker gave', () => {
    expect(attachmentFilename('deed.pdf', 'file:///tmp/x', 'application/pdf')).toBe(
      'deed.pdf'
    );
  });

  it('derives one from the URI when the camera roll gives none', () => {
    expect(attachmentFilename(null, 'file:///tmp/IMG_0042.jpg', 'image/jpeg')).toBe(
      'IMG_0042.jpg'
    );
  });

  it('drops a query string from the derived name', () => {
    expect(attachmentFilename(null, 'file:///tmp/a.jpg?x=1', 'image/jpeg')).toBe('a.jpg');
  });

  it('falls back to the mime type when the URI has no filename', () => {
    expect(attachmentFilename(null, 'file:///tmp/abc123', 'image/png')).toBe(
      'attachment.png'
    );
  });

  it('never returns an empty name', () => {
    expect(attachmentFilename('   ', 'file:///x', null)).toBe('attachment.bin');
  });
});

describe('formatBytes', () => {
  it('scales the unit to the size', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('is blank when the size is unknown', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(0)).toBe('');
  });
});

describe('formatDuration', () => {
  it('renders mm:ss with a padded seconds field', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(75_000)).toBe('1:15');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('treats missing or negative as zero', () => {
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(-500)).toBe('0:00');
  });
});
