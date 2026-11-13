import { describe, expect, it } from 'vitest';
import { launcherLift, type Box } from './launcher-dodge';

const rest: Box = { top: 700, bottom: 748, left: 300, right: 348 };

function box(top: number, bottom: number): Box {
  return { top, bottom, left: 280, right: 360 };
}

function controls(...placed: Box[]) {
  return (at: Box) =>
    placed.filter(
      (control) => control.top < at.bottom && control.bottom > at.top
    );
}

describe('[PRP-020] chat launcher dodges controls', () => {
  it('stays in its corner when nothing interactive is underneath', () => {
    expect(launcherLift(rest, controls(), 240)).toBe(0);
  });

  it('lifts just clear of a button underneath, with a small gap', () => {
    expect(launcherLift(rest, controls(box(720, 768)), 240)).toBe(36);
  });

  it('keeps lifting past a second control the first lift lands on', () => {
    expect(
      launcherLift(rest, controls(box(720, 768), box(660, 708)), 240)
    ).toBe(96);
  });

  it('ignores a large card it only covers a corner of', () => {
    expect(launcherLift(rest, controls(box(500, 900)), 240)).toBe(0);
  });

  it('never lifts further than the cap', () => {
    expect(
      launcherLift(rest, controls(box(720, 768), box(480, 712)), 120)
    ).toBe(36);
  });
});
