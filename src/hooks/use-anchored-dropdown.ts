'use client';

import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

export interface AnchoredPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

interface Viewport {
  width: number;
  height: number;
}

const GAP = 6;
const EDGE = 8;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 360;

export function computeAnchoredPosition(
  rect: AnchorRect,
  viewport: Viewport,
  maxHeight: number = MAX_HEIGHT
): AnchoredPosition {
  const spaceBelow = viewport.height - rect.bottom - GAP - EDGE;
  const spaceAbove = rect.top - GAP - EDGE;
  const openUp = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;
  const available = openUp ? spaceAbove : spaceBelow;

  const height = Math.min(
    maxHeight,
    Math.max(available, MIN_HEIGHT),
    Math.max(viewport.height - 2 * EDGE, 0)
  );

  const top = openUp
    ? Math.max(EDGE, rect.top - GAP - height)
    : Math.max(
        EDGE,
        Math.min(rect.bottom + GAP, viewport.height - EDGE - height)
      );

  const left = Math.max(
    EDGE,
    Math.min(rect.left, viewport.width - rect.width - EDGE)
  );

  return { top, left, width: rect.width, maxHeight: height };
}

export function useAnchoredDropdown(
  isOpen: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  maxHeight: number = MAX_HEIGHT
): AnchoredPosition | null {
  const [position, setPosition] = useState<AnchoredPosition | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition(
      computeAnchoredPosition(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        maxHeight
      )
    );
  }, [anchorRef, maxHeight]);

  const useMeasureEffect =
    typeof window === 'undefined' ? useEffect : useLayoutEffect;

  useMeasureEffect(() => {
    if (!isOpen) return;
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, update]);

  return isOpen ? position : null;
}
