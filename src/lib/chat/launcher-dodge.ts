export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const LAUNCHER_DODGE_GAP = 8;
export const LAUNCHER_DODGE_MAX_CONTROL_HEIGHT = 120;

const INTERACTIVE =
  'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

export function launcherLift(
  rest: Box,
  controlsUnder: (box: Box) => Box[],
  maxLift: number,
  gap = LAUNCHER_DODGE_GAP
): number {
  let lift = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const box = { ...rest, top: rest.top - lift, bottom: rest.bottom - lift };
    const hits = controlsUnder(box).filter(
      (control) =>
        control.bottom - control.top <= LAUNCHER_DODGE_MAX_CONTROL_HEIGHT
    );
    if (hits.length === 0) return lift;
    const next = Math.ceil(
      rest.bottom - Math.min(...hits.map((control) => control.top)) + gap
    );
    if (next <= lift || next > maxLift) return lift;
    lift = next;
  }
  return lift;
}

export function controlsUnderBox(
  box: Box,
  ignore: Element,
  doc: Document = document
): Box[] {
  if (typeof doc.elementsFromPoint !== 'function') return [];
  const insetX = Math.min(6, (box.right - box.left) / 4);
  const insetY = Math.min(6, (box.bottom - box.top) / 4);
  const points: Array<[number, number]> = [
    [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
    [box.left + insetX, box.top + insetY],
    [box.right - insetX, box.top + insetY],
    [box.left + insetX, box.bottom - insetY],
    [box.right - insetX, box.bottom - insetY],
  ];
  const found = new Set<Element>();
  for (const [x, y] of points) {
    const under = doc
      .elementsFromPoint(x, y)
      .find((element) => !ignore.contains(element));
    const control = under?.closest(INTERACTIVE);
    if (control && !ignore.contains(control)) found.add(control);
  }
  return [...found].map((control) => {
    const rect = control.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    };
  });
}
