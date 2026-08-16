import { describe, it, expect } from 'vitest';
import { isEntityTooLarge } from './upload';

describe('isEntityTooLarge', () => {
  // The shape Supabase storage actually returns — measured against the
  // live project, where 51 MB is refused even though the bucket is set
  // to 100 MB, because the project-wide limit is lower.
  const real = {
    statusCode: '413',
    error: 'Payload too large',
    message: 'The object exceeded the maximum allowed size',
  };

  it('recognises the real storage refusal', () => {
    expect(isEntityTooLarge(real)).toBe(true);
  });

  it('recognises it by status alone', () => {
    expect(isEntityTooLarge({ statusCode: '413' })).toBe(true);
  });

  it('recognises it by message alone, if the status is missing', () => {
    expect(
      isEntityTooLarge({
        message: 'The object exceeded the maximum allowed size',
      })
    ).toBe(true);
  });

  it('does not swallow an unrelated storage failure', () => {
    expect(
      isEntityTooLarge({ statusCode: '404', message: 'Bucket not found' })
    ).toBe(false);
    expect(isEntityTooLarge(new Error('network unreachable'))).toBe(false);
  });

  it('tolerates junk rather than throwing', () => {
    expect(isEntityTooLarge(null)).toBe(false);
    expect(isEntityTooLarge(undefined)).toBe(false);
    expect(isEntityTooLarge('too large')).toBe(false);
  });
});
