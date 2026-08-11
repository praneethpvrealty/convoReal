import { describe, expect, it } from 'vitest';
import {
  planLock,
  planUnlock,
  retargetPath,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
} from '@/lib/inventory/gated-photos';

const A = 'acct-1';
const pub = (n: string) => `${PUBLIC_BUCKET}/${A}/${n}`;
const priv = (n: string) => `${PRIVATE_BUCKET}/${A}/${n}`;

describe('retargetPath', () => {
  it('maps a public photo to the private bucket under the same key', () => {
    expect(retargetPath(pub('a.jpg'), 'lock')).toMatchObject({
      key: `${A}/a.jpg`,
      target: priv('a.jpg'),
    });
  });

  it('maps back on unlock', () => {
    expect(retargetPath(priv('a.jpg'), 'unlock')?.target).toBe(pub('a.jpg'));
  });

  it('refuses a photo already on the far side rather than double-moving', () => {
    expect(retargetPath(priv('a.jpg'), 'lock')).toBeNull();
    expect(retargetPath(pub('a.jpg'), 'unlock')).toBeNull();
  });
});

describe('planLock', () => {
  it('moves every public photo out of reach and records what it moved', () => {
    const { update, moved } = planLock({
      images: [pub('a.jpg'), pub('b.jpg')],
      private_images: [],
      gated_locked_images: [],
    });
    expect(update.images).toEqual([]);
    expect(update.private_images).toEqual([priv('a.jpg'), priv('b.jpg')]);
    expect(update.gated_locked_images).toEqual([priv('a.jpg'), priv('b.jpg')]);
    expect(moved).toHaveLength(2);
  });

  it('leaves hand-locked photos alone and does not claim them', () => {
    const { update } = planLock({
      images: [pub('a.jpg')],
      private_images: [priv('facade.jpg')],
      gated_locked_images: [],
    });
    expect(update.private_images).toEqual([priv('facade.jpg'), priv('a.jpg')]);
    // Only the gate's own photo is tracked, so un-gating cannot publish
    // the facade shot the agent locked deliberately.
    expect(update.gated_locked_images).toEqual([priv('a.jpg')]);
  });

  it('is re-runnable after a partial move without forgetting the first pass', () => {
    const { update } = planLock({
      images: [pub('b.jpg')],
      private_images: [priv('a.jpg')],
      gated_locked_images: [priv('a.jpg')],
    });
    expect(update.gated_locked_images).toEqual([priv('a.jpg'), priv('b.jpg')]);
    expect(update.images).toEqual([]);
  });

  it('does nothing for a listing with no photos', () => {
    const { update, moved } = planLock({ images: [], private_images: [] });
    expect(moved).toEqual([]);
    expect(update.images).toEqual([]);
  });
});

describe('planUnlock', () => {
  it('restores exactly what the gate locked', () => {
    const { update, moved } = planUnlock({
      images: [],
      private_images: [priv('a.jpg'), priv('b.jpg')],
      gated_locked_images: [priv('a.jpg'), priv('b.jpg')],
    });
    expect(update.images).toEqual([pub('a.jpg'), pub('b.jpg')]);
    expect(update.private_images).toEqual([]);
    expect(update.gated_locked_images).toEqual([]);
    expect(moved).toHaveLength(2);
  });

  it('never publishes a photo the agent locked by hand', () => {
    const { update } = planUnlock({
      images: [],
      private_images: [priv('facade.jpg'), priv('a.jpg')],
      gated_locked_images: [priv('a.jpg')],
    });
    expect(update.images).toEqual([pub('a.jpg')]);
    expect(update.private_images).toEqual([priv('facade.jpg')]);
  });

  it('ignores a tracked photo that has since been deleted', () => {
    const { update, moved } = planUnlock({
      images: [],
      private_images: [],
      gated_locked_images: [priv('gone.jpg')],
    });
    expect(moved).toEqual([]);
    expect(update.images).toEqual([]);
    expect(update.gated_locked_images).toEqual([]);
  });

  it('keeps photos added while gated', () => {
    const { update } = planUnlock({
      images: [pub('new.jpg')],
      private_images: [priv('a.jpg')],
      gated_locked_images: [priv('a.jpg')],
    });
    expect(update.images).toEqual([pub('new.jpg'), pub('a.jpg')]);
  });
});

describe('round trip', () => {
  it('returns a listing to its starting state', () => {
    const start = {
      images: [pub('a.jpg'), pub('b.jpg')],
      private_images: [priv('facade.jpg')],
      gated_locked_images: [] as string[],
    };
    const locked = planLock(start).update;
    const restored = planUnlock(locked).update;
    expect(restored.images.sort()).toEqual(start.images.sort());
    expect(restored.private_images).toEqual(start.private_images);
    expect(restored.gated_locked_images).toEqual([]);
  });
});
