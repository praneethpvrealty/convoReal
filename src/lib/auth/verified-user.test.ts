import { describe, expect, it, vi } from 'vitest';
import { resolveVerifiedUser } from './verified-user';

const getUserNever = () =>
  vi.fn(async () => {
    throw new Error('getUser must not be called');
  });

describe('resolveVerifiedUser', () => {
  it('[ACC-011] takes the user id from locally verified claims without asking GoTrue', async () => {
    const getUser = getUserNever();
    const result = await resolveVerifiedUser({
      getClaims: async () => ({
        data: { claims: { sub: 'user-1' } },
        error: null,
      }),
      getUser,
    });
    expect(result).toEqual({ userId: 'user-1', error: null });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('[ACC-011] treats a token that fails verification as signed out, without a GoTrue fallback', async () => {
    const getUser = getUserNever();
    const invalid = Object.assign(new Error('Invalid JWT signature'), {
      code: 'invalid_jwt',
    });
    const result = await resolveVerifiedUser({
      getClaims: async () => ({ data: null, error: invalid }),
      getUser,
    });
    expect(result.userId).toBeNull();
    expect(result.error).toBe(invalid);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('[ACC-011] treats a missing session and a token with no subject as signed out', async () => {
    const getUser = getUserNever();
    expect(
      await resolveVerifiedUser({
        getClaims: async () => ({ data: null, error: null }),
        getUser,
      })
    ).toEqual({ userId: null, error: null });
    expect(
      await resolveVerifiedUser({
        getClaims: async () => ({
          data: { claims: { sub: '' } },
          error: null,
        }),
        getUser,
      })
    ).toEqual({ userId: null, error: null });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('[ACC-011] asks GoTrue when local verification cannot run', async () => {
    const getUser = vi.fn(async () => ({
      data: { user: { id: 'user-2' } },
      error: null,
    }));
    const result = await resolveVerifiedUser({
      getClaims: async () => {
        throw new Error('signing keys unreachable');
      },
      getUser,
    });
    expect(result).toEqual({ userId: 'user-2', error: null });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('[ACC-011] reports signed out when GoTrue refuses the fallback', async () => {
    const refused = new Error('no session');
    const result = await resolveVerifiedUser({
      getClaims: async () => {
        throw new Error('signing keys unreachable');
      },
      getUser: async () => ({ data: { user: null }, error: refused }),
    });
    expect(result).toEqual({ userId: null, error: refused });
  });
});
